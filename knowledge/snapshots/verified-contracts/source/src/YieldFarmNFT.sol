// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721A, IERC721A} from "erc721a/contracts/ERC721A.sol";
import {ERC721AQueryable} from "erc721a/contracts/extensions/ERC721AQueryable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {IERC2981} from "@openzeppelin/contracts/interfaces/IERC2981.sol";
import {INonFungibleSeaDropToken} from "./seadrop/INonFungibleSeaDropToken.sol";
import {ISeaDropTokenContractMetadata} from "./seadrop/ISeaDropTokenContractMetadata.sol";
import {ISeaDrop} from "./seadrop/ISeaDrop.sol";
import {
    AllowListData,
    PublicDrop,
    TokenGatedDropStage,
    SignedMintValidationParams
} from "./seadrop/SeaDropStructs.sol";
import {ERC721SeaDropStructsErrorsAndEvents} from "./seadrop/ERC721SeaDropStructsErrorsAndEvents.sol";
import {ERC721TransferValidator} from "./seadrop/ERC721TransferValidator.sol";
import {ICreatorToken, ILegacyCreatorToken} from "./seadrop/ICreatorToken.sol";
import {ITransferValidator721} from "./seadrop/ITransferValidator.sol";
import {ITransferHook} from "./interfaces/ITransferHook.sol";
import {IActivationClearer} from "./interfaces/IActivationClearer.sol";
import {IRarityTier} from "./interfaces/IRarityTier.sol";

/// @notice The 3,333 farm plots. Minting happens EXCLUSIVELY through OpenSea's SeaDrop (public +
///         Merkle-allowlist phases live in SeaDrop config; this contract only exposes the
///         ERC721SeaDrop surface: `mintSeaDrop` gated to the allowed SeaDrop, `getMintStats`, and
///         the owner passthroughs that configure the drop on SeaDrop). Creator fees are enforced
///         on-chain: ERC-2981 royalties (owner-updatable, hard-capped at 10%) plus the ERC721-C
///         style transfer validator hook (Limit Break's creator-token-standards, as integrated by
///         upstream ERC721SeaDrop) which runs BEFORE every transfer and may block it.
///         Everything else is unchanged: BAYC-style provenance reveal, rarity tiers written once
///         from the manifest, base URI with a permanent freeze, an optional activation clearer
///         (Anvil's registry, which only the collection may clear) and an optional transfer hook
///         (native registry / emissions resync) which run AFTER transfers and can never block one.
contract YieldFarmNFT is
    ERC721A,
    ERC721AQueryable,
    ERC721TransferValidator,
    Ownable2Step,
    ReentrancyGuard,
    INonFungibleSeaDropToken,
    ERC721SeaDropStructsErrorsAndEvents,
    IRarityTier
{
    uint256 public constant MAX_SUPPLY = 3333;
    /// @notice ERC-2981 fee ceiling: `setDefaultRoyalty`/`setRoyaltyInfo` reject anything above 10%.
    uint96 public constant MAX_ROYALTY_BPS = 1000;

    bytes32 public immutable manifestHash;
    uint256 public startingIndex; // 0 = not revealed
    uint256 public sellOutBlock; // 0 = not sold out
    /// @notice Reveal is never hostage to a stalled mint: after this timestamp `reveal()` works without a
    /// sell-out (owner decision 2026-08-25: reveal at sell-out or T+72h, whichever first). Immutable so
    /// nobody -- including the owner -- can delay a promised reveal.
    uint256 public immutable revealDeadline;
    bool public tiersFinalized;
    bool public uriFrozen;
    ITransferHook public transferHook;
    IActivationClearer public activationClearer;

    /// @notice Track the allowed SeaDrop addresses (canonical SeaDrop at deploy; owner-updatable).
    mapping(address => bool) internal _allowedSeaDrop;
    address[] internal _enumeratedAllowedSeaDrop;

    mapping(uint256 => uint8) private _tier;
    string private _baseTokenURI;
    string private _contractURI;
    RoyaltyInfo private _royaltyInfo;

    event Revealed(uint256 startingIndex, bytes32 usedHash);
    event TiersSet(uint256 fromId, uint256 count);
    event TiersFinalized();
    event BaseURISet(string uri);
    event URIFrozen();
    event TransferHookSet(address hook);
    event ActivationClearerSet(address clearer);
    event ClearerFailed(uint256 indexed tokenId);
    event HookFailed(uint256 indexed tokenId);

    error AlreadyRevealed();
    error NotSoldOut();
    error InvalidRevealDeadline();
    error NotRevealed();
    error TooEarly();
    error TiersLocked();
    error UriLocked();
    error BadInput();
    error NotContract();
    error MaxSupplyLocked();
    error MintClosedByReveal();
    error RoyaltyExceedsCap(uint256 bps, uint256 cap);

    /// @dev Renounce is disabled: every lever on this contract stays owner-gated for the life of the
    ///      farm, and a renounce would strand them permanently (audit 2026-09-02 T-2). Rotate the key
    ///      with `transferOwnership` + `acceptOwnership` instead.
    error RenounceDisabled();

    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    constructor(bytes32 manifestHash_, address owner_, address[] memory allowedSeaDrop, uint256 revealDeadline_)
        ERC721A("Yield Farm", "PLOT")
        Ownable(owner_)
    {
        if (revealDeadline_ <= block.timestamp) revert InvalidRevealDeadline();
        revealDeadline = revealDeadline_;
        manifestHash = manifestHash_;
        uint256 n = allowedSeaDrop.length;
        for (uint256 i = 0; i < n; ++i) {
            _allowedSeaDrop[allowedSeaDrop[i]] = true;
        }
        _enumeratedAllowedSeaDrop = allowedSeaDrop;
        emit SeaDropTokenDeployed();
    }

    function _startTokenId() internal pure override returns (uint256) {
        return 1;
    }

    function tokenURI(uint256 tokenId) public view override(ERC721A, IERC721A) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721A, IERC721A, IERC165)
        returns (bool)
    {
        return interfaceId == type(INonFungibleSeaDropToken).interfaceId
            || interfaceId == type(ISeaDropTokenContractMetadata).interfaceId
            || interfaceId == type(IERC2981).interfaceId || interfaceId == type(ICreatorToken).interfaceId
            || interfaceId == type(ILegacyCreatorToken).interfaceId || interfaceId == 0x49064906 // ERC-4906
            || ERC721A.supportsInterface(interfaceId); // ERC-165, ERC-721, ERC-721 Metadata
    }

    // ---------------------------------------------------------------- SeaDrop mint
    /// @dev Reverts if `seaDrop` is not an allowed SeaDrop. Inlined function instead of a modifier,
    ///      as in upstream ERC721SeaDrop, to keep bytecode small.
    function _onlyAllowedSeaDrop(address seaDrop) internal view {
        if (!_allowedSeaDrop[seaDrop]) revert OnlyAllowedSeaDrop();
    }

    /// @notice Swap out the allowed SeaDrop contracts. The previous set is fully replaced.
    function updateAllowedSeaDrop(address[] calldata allowedSeaDrop) external onlyOwner {
        uint256 previous = _enumeratedAllowedSeaDrop.length;
        for (uint256 i = 0; i < previous; ++i) {
            _allowedSeaDrop[_enumeratedAllowedSeaDrop[i]] = false;
        }
        uint256 n = allowedSeaDrop.length;
        for (uint256 i = 0; i < n; ++i) {
            _allowedSeaDrop[allowedSeaDrop[i]] = true;
        }
        _enumeratedAllowedSeaDrop = allowedSeaDrop;
        emit AllowedSeaDropUpdated(allowedSeaDrop);
    }

    /// @notice Mint, restricted to the allowed SeaDrop contracts — the ONLY mint path. Phases,
    ///         prices and wallet caps all live in SeaDrop's PublicDrop/allowlist config.
    ///         Closed permanently by `reveal()` (audit M1): once `startingIndex` is public, every
    ///         unminted id's manifest row — and with it its rarity — is computable, so any
    ///         post-reveal mint would be a rarity snipe against everyone who minted blind. The
    ///         runbook keeps SeaDrop's endTime inside the reveal deadline; this is the on-chain
    ///         backstop (a sold-out drop has nothing left to mint, a deadline reveal closes it).
    /// @dev nonReentrant like upstream: with `_safeMint`, a malicious `onERC721Received` could
    ///      otherwise re-enter through a second allowed SeaDrop while stats are mid-update.
    function mintSeaDrop(address minter, uint256 quantity) external nonReentrant {
        _onlyAllowedSeaDrop(msg.sender);
        if (startingIndex != 0) revert MintClosedByReveal();
        // Audit 2026-09-02 (D1 M1): the deadline-path reveal draws from a parent hash that is readable
        // in-block, so minting must be closed on-chain the instant the deadline passes. This makes the
        // runbook's `endTime < revealDeadline` rule a redundancy rather than the only guard.
        if (block.timestamp >= revealDeadline) revert MintClosedByReveal();
        uint256 minted = _totalMinted();
        if (minted + quantity > MAX_SUPPLY) {
            revert MintQuantityExceedsMaxSupply(minted + quantity, MAX_SUPPLY);
        }
        // Audit 2026-09-02 (D8): commit the sell-out block BEFORE the mint's receiver callback runs, so a
        // re-entrant reveal() inside onERC721Received can never take the deadline path with a known hash.
        if (minted + quantity == MAX_SUPPLY && sellOutBlock == 0) sellOutBlock = block.number;
        _safeMint(minter, quantity);
    }

    /// @notice Mint stats SeaDrop reads to enforce maxSupply and per-wallet/per-stage limits.
    function getMintStats(address minter)
        external
        view
        returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply_)
    {
        minterNumMinted = _numberMinted(minter);
        currentTotalSupply = _totalMinted();
        maxSupply_ = MAX_SUPPLY;
    }

    // ---------------------------------------------------------------- SeaDrop config passthroughs
    /// @dev Owner-only wrappers: SeaDrop only accepts config from the token contract itself
    ///      (`onlyINonFungibleSeaDropToken`), so the owner configures the drop through these.
    function updatePublicDrop(address seaDropImpl, PublicDrop calldata publicDrop) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updatePublicDrop(publicDrop);
    }

    function updateAllowList(address seaDropImpl, AllowListData calldata allowListData) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateAllowList(allowListData);
    }

    function updateTokenGatedDrop(address seaDropImpl, address allowedNftToken, TokenGatedDropStage calldata dropStage)
        external
        onlyOwner
    {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateTokenGatedDrop(allowedNftToken, dropStage);
    }

    function updateDropURI(address seaDropImpl, string calldata dropURI) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateDropURI(dropURI);
    }

    function updateCreatorPayoutAddress(address seaDropImpl, address payoutAddress) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateCreatorPayoutAddress(payoutAddress);
    }

    function updateAllowedFeeRecipient(address seaDropImpl, address feeRecipient, bool allowed) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateAllowedFeeRecipient(feeRecipient, allowed);
    }

    function updateSignedMintValidationParams(
        address seaDropImpl,
        address signer,
        SignedMintValidationParams memory signedMintValidationParams
    ) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updateSignedMintValidationParams(signer, signedMintValidationParams);
    }

    function updatePayer(address seaDropImpl, address payer, bool allowed) external onlyOwner {
        _onlyAllowedSeaDrop(seaDropImpl);
        ISeaDrop(seaDropImpl).updatePayer(payer, allowed);
    }

    // ---------------------------------------------------------------- royalties (ERC-2981, capped)
    /// @dev Shared by both setters: zero receiver rejected, fee hard-capped at MAX_ROYALTY_BPS.
    function _setCappedRoyalty(address receiver, uint96 bps) internal {
        if (receiver == address(0)) revert RoyaltyAddressCannotBeZeroAddress();
        if (bps > MAX_ROYALTY_BPS) revert RoyaltyExceedsCap(bps, MAX_ROYALTY_BPS);
        _royaltyInfo = RoyaltyInfo({royaltyAddress: receiver, royaltyBps: bps});
        emit RoyaltyInfoUpdated(receiver, bps);
    }

    /// @notice Default royalty for every token, in basis points of the sale price (500 = 5%).
    function setDefaultRoyalty(address receiver, uint96 feeNumerator) external onlyOwner {
        _setCappedRoyalty(receiver, feeNumerator);
    }

    /// @notice ISeaDropTokenContractMetadata's royalty setter — same capped path.
    function setRoyaltyInfo(RoyaltyInfo calldata newInfo) external onlyOwner {
        _setCappedRoyalty(newInfo.royaltyAddress, newInfo.royaltyBps);
    }

    function royaltyAddress() external view returns (address) {
        return _royaltyInfo.royaltyAddress;
    }

    function royaltyBasisPoints() external view returns (uint256) {
        return _royaltyInfo.royaltyBps;
    }

    /// @notice ERC-2981: royalty is `royaltyBps` of the sale price, to `royaltyAddress`.
    function royaltyInfo(uint256, uint256 salePrice) external view returns (address receiver, uint256 royaltyAmount) {
        RoyaltyInfo storage info = _royaltyInfo;
        royaltyAmount = (salePrice * info.royaltyBps) / 10_000;
        receiver = info.royaltyAddress;
    }

    // ---------------------------------------------------------------- transfer validator (ERC721-C style)
    /// @notice Set the Limit Break-style transfer validator; zero unsets (validation off).
    /// @dev Same codeless-target guard as the hook/clearer: the validator is called with a plain
    ///      (bubbling) external call on every transfer — that blocking power is the feature — but a
    ///      codeless target would revert every transfer with no event to explain why.
    function setTransferValidator(address newValidator) external onlyOwner {
        _requireContractOrZero(newValidator);
        _setTransferValidator(newValidator);
    }

    /// @notice Creator Token Standards introspection: validators are called via
    ///         `validateTransfer(address,address,address,uint256)`.
    function getTransferValidationFunction()
        external
        pure
        returns (bytes4 functionSignature, bool isViewFunction)
    {
        functionSignature = ITransferValidator721.validateTransfer.selector;
        isViewFunction = false;
    }

    /// @dev Transfers only (not mints or burns): the validator may revert to BLOCK the transfer —
    ///      that is the enforcement mechanism, the exact opposite contract of the after-hooks below.
    ///      ERC721A transfers are always quantity 1; batch quantities only occur on mint.
    function _beforeTokenTransfers(address from, address to, uint256 startTokenId, uint256 /* quantity */ )
        internal
        override
    {
        if (from != address(0) && to != address(0)) {
            address transferValidator = _transferValidator;
            if (transferValidator != address(0)) {
                ITransferValidator721(transferValidator).validateTransfer(msg.sender, from, to, startTokenId);
            }
        }
    }

    // ---------------------------------------------------------------- provenance
    function reveal() external {
        if (startingIndex != 0) revert AlreadyRevealed();
        bytes32 h;
        if (sellOutBlock != 0) {
            // sell-out path: committed randomness from the block after the final mint
            if (block.number <= sellOutBlock + 1) revert TooEarly();
            h = blockhash(sellOutBlock + 1);
            if (h == bytes32(0)) h = blockhash(block.number - 1); // more than 256 blocks passed
        } else {
            // deadline path (partial mint): reveal must still happen -- randomness from the parent block.
            // Miner influence is bounded and worthless here: the manifest hash was committed pre-mint and
            // the offset only rotates which committed row each token gets.
            if (block.timestamp < revealDeadline) revert NotSoldOut();
            h = blockhash(block.number - 1);
        }
        uint256 idx = uint256(h) % MAX_SUPPLY;
        if (idx == 0) idx = 1;
        startingIndex = idx;
        emit Revealed(idx, h);
    }

    /// @notice Row of the committed manifest that describes `tokenId`.
    function manifestRow(uint256 tokenId) external view returns (uint256) {
        if (startingIndex == 0) revert NotRevealed();
        return (tokenId - 1 + startingIndex) % MAX_SUPPLY;
    }

    /// @notice ISeaDropTokenContractMetadata alias for the manifest commitment (set once, at deploy).
    function provenanceHash() external view returns (bytes32) {
        return manifestHash;
    }

    /// @dev The provenance hash is an immutable constructor commitment here; it can never be
    ///      (re)set. Upstream's error is reused so drop tooling reads a familiar signal.
    function setProvenanceHash(bytes32) external view onlyOwner {
        revert ProvenanceHashCannotBeSetAfterMintStarted();
    }

    // ---------------------------------------------------------------- supply
    function maxSupply() external pure returns (uint256) {
        return MAX_SUPPLY;
    }

    /// @dev The 3,333 cap is a constant; ISeaDropTokenContractMetadata's setter always reverts.
    function setMaxSupply(uint256) external view onlyOwner {
        revert MaxSupplyLocked();
    }

    // ---------------------------------------------------------------- rarity tiers
    /// @notice Tiers come from the manifest row of each token, which only exists after the reveal.
    function setRarityTiers(uint256 fromId, uint8[] calldata tiers) external onlyOwner {
        if (startingIndex == 0) revert NotRevealed();
        if (tiersFinalized) revert TiersLocked();
        if (fromId == 0 || tiers.length == 0 || fromId + tiers.length - 1 > MAX_SUPPLY) revert BadInput();
        for (uint256 i; i < tiers.length; ++i) {
            if (tiers[i] > 3) revert BadInput();
            _tier[fromId + i] = tiers[i];
        }
        emit TiersSet(fromId, tiers.length);
    }

    function finalizeTiers() external onlyOwner {
        if (startingIndex == 0) revert NotRevealed();
        tiersFinalized = true;
        emit TiersFinalized();
    }

    function rarityTier(uint256 tokenId) external view returns (uint8) {
        return _tier[tokenId];
    }

    // ---------------------------------------------------------------- metadata
    function setBaseURI(string calldata uri) external onlyOwner {
        if (uriFrozen) revert UriLocked();
        _baseTokenURI = uri;
        emit BaseURISet(uri);
        // ERC-4906, as in upstream ERC721SeaDrop: tells marketplaces to refresh metadata.
        if (totalSupply() != 0) {
            emit BatchMetadataUpdate(1, _nextTokenId() - 1);
        }
    }

    function freezeURI() external onlyOwner {
        uriFrozen = true;
        emit URIFrozen();
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function baseURI() external view returns (string memory) {
        return _baseTokenURI;
    }

    function setContractURI(string calldata newContractURI) external onlyOwner {
        _contractURI = newContractURI;
        emit ContractURIUpdated(newContractURI);
    }

    function contractURI() external view returns (string memory) {
        return _contractURI;
    }

    // ---------------------------------------------------------------- transfer hook + activation clearer
    /// @dev Zero unsets. A codeless target is rejected: try/catch cannot catch the caller-side extcodesize
    ///      revert, so such a target would block every transfer.
    function _requireContractOrZero(address a) internal view {
        if (a != address(0) && a.code.length == 0) revert NotContract();
    }

    function setTransferHook(ITransferHook hook) external onlyOwner {
        _requireContractOrZero(address(hook));
        transferHook = hook;
        emit TransferHookSet(address(hook));
    }

    function setActivationClearer(IActivationClearer clearer) external onlyOwner {
        _requireContractOrZero(address(clearer));
        activationClearer = clearer;
        emit ActivationClearerSet(address(clearer));
    }

    /// @dev Transfers only (not mints). The clearer runs first so the hook's resync sees the cleared state.
    ///      Both calls are try/catch: a reverting or misconfigured target emits an event and the transfer proceeds.
    function _afterTokenTransfers(address from, address to, uint256 startTokenId, uint256 quantity) internal override {
        if (from == address(0)) return;
        IActivationClearer clearer = activationClearer;
        ITransferHook hook = transferHook;
        for (uint256 i; i < quantity; ++i) {
            uint256 id = startTokenId + i;
            if (address(clearer) != address(0)) {
                try clearer.clearActivation(id) {}
                catch {
                    emit ClearerFailed(id);
                }
            }
            if (address(hook) != address(0)) {
                try hook.afterTransfer(from, to, id) {}
                catch {
                    emit HookFailed(id);
                }
            }
        }
    }
}

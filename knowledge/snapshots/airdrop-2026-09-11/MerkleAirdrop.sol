// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface IGranarySink {
    function addToGranary(uint256 amount) external;
}

/// @notice Partner airdrop: Merkle claims until `deadline`, then anyone can sweep the remainder into the Granary.
contract MerkleAirdrop {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    bytes32 public immutable root;
    uint256 public immutable deadline;
    IGranarySink public immutable sink;

    mapping(uint256 => uint256) private _claimedBitmap;

    event Claimed(uint256 indexed index, address indexed account, uint256 amount);
    event Swept(uint256 amount);

    error AlreadyClaimed();
    error InvalidProof();
    error ClaimClosed();
    error ClaimOpen();

    constructor(IERC20 token_, bytes32 root_, uint256 deadline_, IGranarySink sink_) {
        token = token_;
        root = root_;
        deadline = deadline_;
        sink = sink_;
    }

    function isClaimed(uint256 index) public view returns (bool) {
        return (_claimedBitmap[index >> 8] >> (index & 0xff)) & 1 == 1;
    }

    function claim(uint256 index, address account, uint256 amount, bytes32[] calldata proof) external {
        if (block.timestamp > deadline) revert ClaimClosed();
        if (isClaimed(index)) revert AlreadyClaimed();
        bytes32 leaf = keccak256(abi.encodePacked(index, account, amount));
        if (!MerkleProof.verifyCalldata(proof, root, leaf)) revert InvalidProof();
        _claimedBitmap[index >> 8] |= 1 << (index & 0xff);
        token.safeTransfer(account, amount);
        emit Claimed(index, account, amount);
    }

    function sweep() external {
        if (block.timestamp <= deadline) revert ClaimOpen();
        uint256 bal = token.balanceOf(address(this));
        token.forceApprove(address(sink), bal);
        sink.addToGranary(bal);
        emit Swept(bal);
    }
}

#!/usr/bin/env python3
"""Verify and atomically activate a Farm Companion static release on the VPS."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil

SITE = Path('/opt/farm-companion/site')
RELEASE = re.compile(r'^\d{8}T\d{6}Z-[a-f0-9]{12}$')
PUBLIC_FILES = frozenset(['index.html','app.js','plan-worker.js','yield-farm-companion.user.js',
    'farm-companion-chrome.zip','build.json','ART-CREDITS.txt','FONT-LICENSES.txt','INSTALL-CHROME.txt','README.txt'])


def validate_id(value):
    if not isinstance(value,str) or not RELEASE.fullmatch(value):
        raise ValueError('Invalid release identifier')
    return value


def verify(site, release_id):
    validate_id(release_id)
    folder = site/'releases'/release_id
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError('Release must be a real directory')
    if {p.name for p in folder.iterdir()} != PUBLIC_FILES | {'release.json'}:
        raise ValueError('Unexpected or missing release files')
    if any(p.is_symlink() or not p.is_file() for p in folder.iterdir()):
        raise ValueError('Release contains non-regular files')
    manifest=json.loads((folder/'release.json').read_text())
    if manifest.get('release_id') != release_id or set(manifest.get('files',{})) != PUBLIC_FILES:
        raise ValueError('Invalid release manifest')
    for name, digest in manifest['files'].items():
        if hashlib.sha256((folder/name).read_bytes()).hexdigest() != digest:
            raise ValueError(f'Checksum mismatch: {name}')
    build=json.loads((folder/'build.json').read_text())
    if build.get('release_id')!=release_id:
        raise ValueError('Build metadata does not identify this release')
    if f'/releases/{release_id}/app.js' not in (folder/'index.html').read_text():
        raise ValueError('Entry point must use immutable release assets')
    return manifest


def current(site):
    path=site/'current'
    if path.is_symlink():
        value=os.readlink(path)
        if not value.startswith('releases/'):
            raise ValueError('Unexpected current release target')
        return validate_id(value.removeprefix('releases/'))
    if path.exists():
        raise ValueError('Refusing to overwrite a non-symlink site root')
    return None


def activate(site, release_id):
    verify(site,release_id)
    previous=current(site)
    next_link=site/'.next-release'
    if next_link.is_symlink(): next_link.unlink()
    elif next_link.exists(): raise ValueError('Unexpected next-release path')
    next_link.symlink_to(f'releases/{release_id}')
    os.replace(next_link,site/'current')
    return {'current':release_id,'previous':previous}


def rollback(site, target, expected):
    if current(site)!=validate_id(expected):
        raise ValueError('Current release changed; refusing an unrelated rollback')
    if target=='none':
        (site/'current').unlink()
        return {'current':None,'previous':expected}
    return activate(site,validate_id(target))


def prune(site, keep=30):
    active=current(site)
    folders=sorted((p for p in (site/'releases').iterdir() if RELEASE.fullmatch(p.name) and p.is_dir() and not p.is_symlink()),reverse=True)
    for folder in folders[keep:]:
        if folder.name!=active: shutil.rmtree(folder)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=['activate','rollback','status','prune'])
    parser.add_argument('release',nargs='?')
    parser.add_argument('--expected')
    args=parser.parse_args()
    SITE.mkdir(parents=True,exist_ok=True)
    with (SITE/'.deployment.lock').open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        if args.command=='activate': result=activate(SITE,args.release)
        elif args.command=='rollback': result=rollback(SITE,args.release,args.expected)
        elif args.command=='prune': prune(SITE);result={'current':current(SITE)}
        else: result={'current':current(SITE)}
    print(json.dumps(result))

if __name__=='__main__': main()

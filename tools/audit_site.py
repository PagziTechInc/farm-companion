"""Read public linked game pages; retain hashes, headings and interface declarations.

No wallet access. Artifacts are observations, never automatic rule updates.
"""
import concurrent.futures
import datetime
import hashlib
import json
import re
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

PAGES = ['almanac', 'townhall', 'store', 'provenance', 'security', 'swap', 'farm', 'deeds', 'check', 'charter']


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.scripts, self.links, self.headings = [], [], []
        self.heading = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'script' and attrs.get('src'):
            self.scripts.append(attrs['src'])
        if tag == 'a' and attrs.get('href'):
            self.links.append(attrs['href'])
        if tag in ('h1', 'h2', 'h3'):
            self.heading = []

    def handle_data(self, data):
        if self.heading is not None:
            self.heading.append(data)

    def handle_endtag(self, tag):
        if tag in ('h1', 'h2', 'h3') and self.heading is not None:
            self.headings.append(' '.join(''.join(self.heading).split()))
            self.heading = None


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'FarmCompanion-research/1.1'})
        with urllib.request.urlopen(req, timeout=20) as response:
            body = response.read(8_000_000)
            return {'url': url, 'status': response.status, 'sha256': hashlib.sha256(body).hexdigest(), 'bytes': len(body)}, body.decode('utf-8')
    except Exception as error:
        return {'url': url, 'error': str(error)}, ''


def main():
    records, scripts = [], set()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for record, body in pool.map(fetch, [f'https://rh.farm/{page}/' for page in PAGES]):
            parser = Page()
            parser.feed(body)
            record.update(headings=parser.headings, links=sorted(set(parser.links)))
            records.append(record)
            scripts.update(urljoin(record['url'], src) for src in parser.scripts if src.startswith('/_next/static/'))
        interfaces = []
        for record, body in pool.map(fetch, sorted(scripts)):
            record['declarations'] = sorted(set(re.findall(r'"((?:function|event) [A-Za-z_]\w*\([^"\\\n]{0,300})"', body)))
            record['api_paths'] = sorted(set(re.findall(r'/(?:stats|metadata|manifest|weather|drawings|tickets|quotes|listings)[\w/.$?={}-]*', body)))
            interfaces.append(record)
    report = {'schema_version': 1, 'observed_at_utc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'authority': 'Almanac controls gameplay rules per user instruction. Other pages and client declarations are supporting evidence.',
              'pages': records, 'scripts': interfaces}
    day = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    path = Path(f'knowledge/snapshots/site-audit-{day}.json')
    path.write_text(json.dumps(report, indent=2) + '\n')
    print(f'{len(records)} pages, {len(interfaces)} linked scripts; {sum("error" in r for r in records + interfaces)} read errors. Saved {path}')


if __name__ == '__main__':
    main()

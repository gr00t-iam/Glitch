"""Conservative artifact intent and host-owned write receipts for one task."""
import hashlib
import re
from pathlib import Path

PATH = re.compile(r"(?<![\w/])([\w./-]+\.[a-z][a-z0-9]{0,9})\b", re.I)
QUOTED_PATH = re.compile(r'''["`']([^"`'\r\n]+\.[a-z][a-z0-9]{0,9})["`']''', re.I)
MUTATE = re.compile(r'\b(create|build|make|write|save|generate|update|edit|replace|implement|fix)\b', re.I)
ARTIFACT = re.compile(r'\b(file|website|webpage|wiki|page|document|script|app)\b', re.I)
EXPLAIN = re.compile(r'^\s*(?:please\s+)?(explain|describe|how\b|what\b|why\b|show me how|tell me how)', re.I)
CLAIM = re.compile(r'\b(created|written|saved|built|updated|generated|implemented|fixed)\b', re.I)
EXECUTED = re.compile(r'^(?:\s*(?:i|we)\s+(?:(?:have|just|successfully)\s+)?)?(?:created|written|saved|built|updated|generated|implemented|fixed)\b', re.I)
HISTORICAL_QUERY = re.compile(r'^\s*(?:please\s+)?what\b[^?]*\?\s*$', re.I)
PAST = re.compile(r'\b(yesterday|earlier|previously|before|last (?:turn|time|session|week))\b', re.I)
CURRENT = re.compile(r'\b(now|today|again|this turn)\b', re.I)


def paths_in(text):
    quoted = QUOTED_PATH.findall(text)
    unquoted = PATH.findall(QUOTED_PATH.sub('', text))
    return list(dict.fromkeys(quoted + unquoted))


class ArtifactEvidence:
    def __init__(self, prompt, previous_events=()):
        self.explanation = bool(EXPLAIN.search(prompt))
        self.historical_query = bool(HISTORICAL_QUERY.fullmatch(prompt) and PAST.search(prompt) and not CURRENT.search(prompt))
        mutation = MUTATE.search(prompt) if not self.explanation else None
        requested = prompt[mutation.start():] if mutation else ''
        self.paths = paths_in(requested)
        self.required = bool(mutation and (self.paths or ARTIFACT.search(requested)))
        self.writes = {}
        self.previous_events = previous_events
        self.historical_files = None

    def _verified_history(self, tools):
        if self.historical_files is not None:
            return self.historical_files
        verified, writes, readbacks = set(), {}, set()
        for event in self.previous_events:
            if event['kind'] in ('started', 'paused', 'stopped'):
                writes, readbacks = {}, set()
            elif event['kind'] == 'completed':
                verified.update(readbacks)
            elif event['kind'] == 'result' and event['title'] in ('write_file', 'read_file'):
                result = event['payload'].get('result', {})
                if result.get('ok') is not True:
                    continue
                try:
                    path = tools.resolve(result.get('path'))
                except ValueError:
                    continue
                size = result.get('bytes')
                if type(size) is not int or not 0 <= size <= 1_000_000:
                    continue
                if event['title'] == 'write_file':
                    writes[path] = size
                elif (writes.get(path) == size and
                      isinstance(result.get('absolute_path'), str) and Path(result['absolute_path']) == path and
                      isinstance(result.get('sha256'), str) and re.fullmatch('[0-9a-f]{64}', result['sha256'])):
                    readbacks.add(path)
        self.historical_files = verified
        return verified

    def record(self, name, args, result):
        if name == 'write_file' and result.get('ok') is True:
            self.required = True
            self.writes[args['path']] = hashlib.sha256(args['content'].encode('utf-8')).hexdigest()

    def verify(self, tools, message):
        execution_claim = CLAIM.search(message) and (not self.explanation or EXECUTED.search(message) or self.historical_query)
        claims = paths_in(message) if execution_claim else []
        claimed_artifact = bool(execution_claim and (claims or ARTIFACT.search(message)))
        if not self.required and not claimed_artifact:
            return []
        if self.historical_query and claims and PAST.search(message) and not CURRENT.search(message):
            if any(tools.resolve(path) not in self._verified_history(tools) for path in claims):
                raise ValueError('Missing prior verified write/readback evidence for historical artifacts: ' +
                                 ', '.join(claims) + '. Do not invent history or rewrite files to substantiate a past claim.')
            if not self.required:
                return []  # Prior proof grounds a past fact, not a new artifact snapshot.
        paths = list(dict.fromkeys(self.paths + list(self.writes) + claims))
        receipts = {tools.resolve(path): digest for path, digest in self.writes.items()}
        if not paths or any(tools.resolve(path) not in receipts for path in paths):
            raise ValueError('Missing successful write_file evidence for requested artifacts: ' +
                             ', '.join(paths or ['a file in the selected workspace']) +
                             '. Use explicit relative paths and verify readback; never claim a file was created from listing alone. '
                             'Respect denied approvals; do not bypass or retry a denied action without user permission.')
        unique = {tools.resolve(path): path for path in paths}
        return [tools.readback(path, receipts[resolved]) for resolved, path in unique.items()]

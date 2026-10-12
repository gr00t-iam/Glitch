"""Bound repository tools; models choose operations, humans authorize destinations."""
import json
from pathlib import Path

from glitch.github_service import branch, file_path, check
from glitch.redaction import GITHUB_RESULT


def schema(name, description, properties, required=()):
    return {'name': name, 'description': description, 'parameters': {
        'type': 'object', 'additionalProperties': False, 'properties': properties,
        'required': list(required)}}


STRING = {'type': 'string'}
PATHS = {'type': 'array', 'items': STRING, 'minItems': 1, 'maxItems': 100}
GITHUB_SCHEMAS = [
    schema('github_list_repositories', 'List repositories using a saved GitHub connection ID; secrets stay on host.',
           {'credential_id': STRING}, ('credential_id',)),
    schema('github_clone_repo', 'Clone the bound GitHub repository into a new child directory after explicit approval.',
           {'folder': STRING}, ('folder',)),
    schema('github_repo_status', 'Inspect the registered project checkout; no external Git process.', {}),
    schema('github_diff', 'Review explicit paths with complete-source credential redaction.', {'paths': PATHS}, ('paths',)),
    schema('github_create_branch', 'Create or fetch and fast-forward a non-default, unprotected feature branch after exact review. Dirty worktrees and divergence are refused.',
           {'branch': STRING}, ('branch',)),
    schema('github_commit_and_push', 'Commit only explicit reviewed text paths and push fast-forward to the bound repository. '
           'No force, reset, delete or merge. Retry the identical request to recover a retained local commit.',
           {'paths': PATHS, 'branch': STRING, 'title': STRING, 'body': STRING}, ('paths', 'branch', 'title', 'body')),
    schema('github_create_pull_request', 'Create a PR for the bound published head/base after approval; searches before retry.',
           {key: STRING for key in ('head', 'base', 'title', 'body')}, ('head', 'base', 'title', 'body')),
]


class GitHubTools:
    def __init__(self, service, workspace, approve, emit, cancel):
        self.service, self.workspace = service, Path(workspace)
        self.approve, self.emit, self.cancel = approve, emit, cancel

    def execute(self, name, args):
        check(self.cancel, float('inf'))
        rule = next((item['parameters'] for item in GITHUB_SCHEMAS if item['name'] == name), None)
        if (rule is None or not isinstance(args, dict) or set(args) - set(rule['properties']) or
                any(key not in args for key in rule['required'])):
            raise ValueError('Unknown GitHub tool or unexpected/missing arguments.')
        args = json.loads(json.dumps(args, allow_nan=False))
        for key, value in args.items():
            if key == 'paths':
                if (not isinstance(value, list) or not 1 <= len(value) <= 100 or
                        any(not isinstance(item, str) for item in value) or len({item.casefold() for item in value}) != len(value)):
                    raise ValueError('Select 1-100 distinct explicit file paths.')
                for path in value:
                    file_path(path)
            elif not isinstance(value, str) or len(value) > (20000 if key == 'body' else 200):
                raise ValueError('GitHub arguments must be bounded strings.')
        for key in ('branch', 'head', 'base'):
            if key in args:
                branch(args[key])
        if 'title' in args and (not args['title'].strip() or '\n' in args['title'] or '\r' in args['title']):
            raise ValueError('Use a nonempty single-line commit or PR title.')
        if 'folder' in args and len(file_path(args['folder'])) != 1:
            raise ValueError('Clone into one new child folder.')
        if name == 'github_list_repositories':
            result = {'ok': True, 'repositories': self.service.repositories(args['credential_id'], self.cancel)}
        elif name in ('github_repo_status', 'github_diff'):
            connection = self.service.connection(self.workspace)
            # Services own the lease. No human/model wait occurs under it.
            result = (self.service.status(self.workspace, cancel=self.cancel, connection=connection) if name == 'github_repo_status' else
                      self.service.diff(self.workspace, args['paths'], cancel=self.cancel, connection=connection))
            if name == 'github_repo_status':
                result['credential_id'] = connection['credential_id']
                result['repository'] = {key: connection[key] for key in ('owner', 'name', 'default_branch')}
                result['repository']['full_name'] = connection['owner'] + '/' + connection['name']
        else:
            review = self.service.prepare(self.workspace, name, args, self.cancel)
            preview = json.loads(review.preview)
            if not self.approve(name, preview):
                return {'ok': False, 'denied': True, 'error': 'User denied the GitHub action. Revise the plan.'}
            check(self.cancel, float('inf'))
            result = self.service.mutate(self.workspace, review, self.cancel)
        return self.service.vault.redact(result, GITHUB_RESULT)

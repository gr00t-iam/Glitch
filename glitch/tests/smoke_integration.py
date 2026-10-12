"""CLI-only disposable DPAPI/Git/history/context gate; no UI, model or public network."""
import argparse
import io
import json
import sys
import unittest
from pathlib import Path


def run(output_directory):
    from glitch.tests import test_vault, test_github_service, test_github_tools
    from glitch.tests import test_github_pull, test_history_lifecycle, test_preview_boundaries
    from glitch.tests.smoke_context import run as context_run

    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    cases = [
        test_vault.VaultTests('test_production_dpapi_and_restart'),
        test_github_service.GitHubTests('test_clone_native_status_staged_and_worktree_diff_no_git_process'),
        test_github_tools.PublishingTests('test_explicit_paths_only_and_real_remote_commit'),
        test_github_tools.PublishingTests('test_unsafe_default_and_protected_branches'),
        test_history_lifecycle.HistoryLifecycleTests('test_project_removal_preserves_files_and_vault'),
        test_history_lifecycle.HistoryLifecycleTests('test_watermarks_restart_archive_and_new_visibility'),
    ]
    loader = unittest.TestLoader()
    suite = unittest.TestSuite(cases)
    suite.addTests(loader.loadTestsFromTestCase(test_github_pull.PullTests))
    # A frozen windowed executable is not a Python CLI. Never launch it with -c.
    suite.addTests(test_preview_boundaries.PreviewTests(name)
                   for name in loader.getTestCaseNames(test_preview_boundaries.PreviewTests)
                   if not name.startswith('test_command_'))
    log = io.StringIO()
    tested = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
    result = {'passed': tested.wasSuccessful() and not tested.skipped,
              'execution': 'frozen' if getattr(sys, 'frozen', False) else 'source',
              'tests_run': tested.testsRun, 'skips': len(tested.skipped),
              'live_github': False, 'model_inference': False, 'native_ui': False,
              'log': log.getvalue()}
    try:
        result['context'] = context_run(output / 'context.json')
        result['passed'] &= result['context']['passed']
    except Exception:
        result.update(passed=False, context={'passed': False, 'error': 'Disposable context fixture failed.'})
    (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('output_directory')
    evidence = run(parser.parse_args().output_directory)
    print(json.dumps(evidence, indent=2))
    raise SystemExit(0 if evidence['passed'] else 1)

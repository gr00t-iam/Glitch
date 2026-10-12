from glitch.main import main, show_startup_error

if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    import sys
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--smoke-test':
            from glitch.tests.smoke_desktop import run
            result = run(sys.argv[2])
            sys.exit(0 if result['passed'] else 1)
        elif len(sys.argv) == 4 and sys.argv[1] == '--inference-test':
            from glitch.tests.smoke_inference import run
            result = run(sys.argv[2], sys.argv[3])
            sys.exit(0 if result['passed'] else 1)
        elif len(sys.argv) == 4 and sys.argv[1] == '--parallel-test':
            from glitch.tests.smoke_parallel import run
            result = run(sys.argv[2], sys.argv[3])
            sys.exit(0 if result['passed'] else 1)
        elif len(sys.argv) == 3 and sys.argv[1] == '--voice-test':
            from glitch.tests.smoke_voice import run
            result = run(sys.argv[2])
            sys.exit(0 if result['passed'] else 1)
        elif len(sys.argv) == 4 and sys.argv[1] == '--gpu-test':
            from glitch.tests.smoke_gpu import run
            result = run(sys.argv[2], sys.argv[3])
            sys.exit(0 if result['passed'] else 1)
        elif len(sys.argv) == 3 and sys.argv[1] in (
                '--vault-test', '--history-test', '--context-test',
                '--github-test', '--github-tools-test', '--integration-test'):
            from pathlib import Path
            import importlib
            name = sys.argv[1][2:-5].replace('-', '_')
            helper = importlib.import_module('glitch.tests.smoke_' + name)
            output = Path(sys.argv[2]).resolve()
            output.mkdir(parents=True, exist_ok=True)
            result = helper.run(output / 'result.json' if name in ('history', 'context') else output)
            sys.exit(0 if result['passed'] else 1)
        else:
            main()
    except Exception as error:
        if len(sys.argv) >= 3 and sys.argv[1].endswith('-test'):
            import json
            from pathlib import Path
            output = Path(sys.argv[2]).resolve()
            output.mkdir(parents=True, exist_ok=True)
            (output / 'result.json').write_text(json.dumps({'passed': False,
                'error': 'Disposable verification failed: ' + type(error).__name__}), encoding='utf-8')
        else:
            show_startup_error(error)
        sys.exit(1)

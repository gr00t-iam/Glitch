from glitch.main import main

if __name__ == '__main__':
    import ctypes
    import sys
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--smoke-test':
            from glitch.tests.smoke_desktop import run
            result = run(sys.argv[2])
            sys.exit(0 if result['passed'] else 1)
        else:
            main()
    except Exception as error:
        ctypes.windll.user32.MessageBoxW(None, f'Glitch could not start.\n\n{error}\n\nCheck Microsoft Edge WebView2 Runtime is installed.', 'Glitch', 0x10)

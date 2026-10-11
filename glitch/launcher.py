from glitch.main import main, show_startup_error

if __name__ == '__main__':
    import sys
    try:
        if len(sys.argv) == 3 and sys.argv[1] == '--smoke-test':
            from glitch.tests.smoke_desktop import run
            result = run(sys.argv[2])
            sys.exit(0 if result['passed'] else 1)
        else:
            main()
    except Exception as error:
        show_startup_error(error)
        sys.exit(1)

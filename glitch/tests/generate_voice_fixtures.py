"""Generate synthetic test speech to WAV files, never to speakers."""
from pathlib import Path


def run():
    import comtypes
    import comtypes.client
    comtypes.CoInitialize()
    try:
        destination = Path(__file__).parent / 'fixtures' / 'voice'
        destination.mkdir(parents=True, exist_ok=True)
        voice = comtypes.client.CreateObject('SAPI.SpVoice', dynamic=True)
        for name, text in [('wake', 'Hey Glitch'), ('negative', 'The weather is sunny today'), ('dictation', 'Please create a new document')]:
            stream = comtypes.client.CreateObject('SAPI.SpFileStream', dynamic=True)
            stream.Format.Type = 18  # SAPI 16 kHz, 16-bit mono.
            stream.Open(str((destination / (name + '.wav')).resolve()), 3)
            voice.AudioOutputStream = stream
            voice.Speak(text, 16)
            stream.Close()
        print(destination)
    finally:
        comtypes.CoUninitialize()


if __name__ == '__main__':
    run()

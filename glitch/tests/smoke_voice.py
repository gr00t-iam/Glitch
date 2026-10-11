"""Offline DLL/model and silent Windows voice-enumeration smoke test."""
import json
import shutil
import tempfile
import time
import wave
from pathlib import Path


def run(output_directory):
    from glitch.audio import AudioCoordinator
    from glitch.speech_output import SpeechOutputService
    import sounddevice
    import vosk
    output = Path(output_directory)
    output.mkdir(parents=True, exist_ok=True)
    result = {'passed': False, 'checks': []}
    with tempfile.TemporaryDirectory() as root:
        audio = AudioCoordinator(root)
        speech = SpeechOutputService(audio, lambda: {})
        try:
            audio.models.start_download()
            deadline = time.monotonic() + 120
            while audio.models.status()['phase'] == 'downloading' and time.monotonic() < deadline:
                time.sleep(.1)
            assert audio.models.status()['phase'] == 'ready', audio.models.status()
            vosk.SetLogLevel(-1)
            model = vosk.Model(str(audio.models.model_path()))
            recognizer = vosk.KaldiRecognizer(model, 16000)
            recognizer.AcceptWaveform(bytes(32000))
            assert json.loads(recognizer.FinalResult())['text'] == ''
            result['checks'].append('Frozen offline recognizer loads verified weights and processes PCM without opening microphone')
            from glitch.audio import wake_match
            fixtures = Path(__file__).parent / 'fixtures' / 'voice'
            recognized = {}
            for name in ('wake', 'negative', 'dictation'):
                with wave.open(str(fixtures / (name + '.wav'))) as source:
                    assert source.getnchannels() == 1 and source.getsampwidth() == 2
                    detector = vosk.KaldiRecognizer(model, source.getframerate(), json.dumps(['hey glitch', '[unk]'])) if name != 'dictation' else vosk.KaldiRecognizer(model, source.getframerate())
                    detector.SetWords(True)
                    detector.AcceptWaveform(source.readframes(source.getnframes()))
                    recognized[name] = json.loads(detector.FinalResult())
            assert wake_match(recognized['wake']), recognized
            assert not wake_match(recognized['negative']), recognized
            assert recognized['dictation']['text'], recognized
            result['recognized'] = recognized
            result['checks'].append('Synthetic positive/negative wake phrases and dictation pass offline fixture recognition')
            deadline = time.monotonic() + 10
            while not speech.voices() and not speech.status()['error'] and time.monotonic() < deadline:
                time.sleep(.1)
            assert speech.voices(), speech.status()
            result['voices'] = speech.voices()
            result['checks'].append('Windows SAPI voices enumerate on the dedicated COM thread without playing audio')
            assert audio.status()['phase'] == 'off'
            result['checks'].append('Hands-free listening and speaker announcements remain off by default')
            result['passed'] = True
        except Exception as error:
            result['error'] = str(error)
        finally:
            speech.close()
            audio.close()
            (output / 'result.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    return result

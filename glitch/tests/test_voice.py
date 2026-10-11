import tempfile
import unittest
import threading
import queue
from pathlib import Path
from glitch.audio import AudioCoordinator, wake_match
from glitch.speech_output import SpeechOutputService, spoken_report


class VoiceTests(unittest.TestCase):
    def test_exact_wake(self):
        self.assertTrue(wake_match({'text': 'hey glitch', 'result': [{'conf': .95}, {'conf': .91}]}))
        for text in ('glitch', 'hey glitch fix files', 'a glitch', ''):
            self.assertFalse(wake_match({'text': text, 'result': [{'conf': 1}, {'conf': 1}]}))
        self.assertFalse(wake_match({'text': 'hey glitch', 'result': [{'conf': .5}, {'conf': 1}]}))

    def test_sanitize(self):
        text = spoken_report('Done. ```secret file contents``` Visit https://example.com token=secret')
        self.assertNotIn('secret', text)
        self.assertNotIn('https', text)
        self.assertLessEqual(len(spoken_report('x' * 1000)), 600)

    def test_off_by_default_and_late_results(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = AudioCoordinator(Path(folder))
            self.assertEqual(audio.status()['phase'], 'off')
            self.assertFalse(audio.status()['wake_enabled'])
            audio._generation = 'new'
            audio._publish('old', interim='late')
            self.assertEqual(audio.status()['interim'], '')
            audio.close()

    def test_completion_filter_and_secret_redaction(self):
        service = SpeechOutputService.__new__(SpeechOutputService)
        service.lock = threading.Lock()
        service.commands = queue.Queue(maxsize=8)
        service.seen = set()
        service.settings = lambda: {'announce_completed_tasks': True}
        service.secrets = lambda: ['private-unusual-key']
        service.on_completed({'id': 1, 'parent_id': 'parent', 'text': 'Child finished'})
        self.assertTrue(service.commands.empty())
        event = {'id': 2, 'parent_id': None, 'text': 'Done private-unusual-key'}
        service.on_completed(event)
        service.on_completed(event)
        self.assertEqual(service.commands.qsize(), 1)
        self.assertNotIn('private-unusual-key', service.commands.get()[0])
        service.settings = lambda: {'announce_completed_tasks': False}
        service.on_completed({'id': 3, 'text': 'Do not speak'})
        self.assertTrue(service.commands.empty())

    def test_mute_and_playback_never_restart_dictation(self):
        with tempfile.TemporaryDirectory() as folder:
            audio = AudioCoordinator(Path(folder))
            audio._mode = 'dictating'
            self.assertFalse(audio.begin_playback())
            audio.mute()
            self.assertTrue(audio.begin_playback())
            audio.end_playback()
            self.assertEqual(audio.status()['phase'], 'off')
            self.assertFalse(audio.status()['wake_enabled'])
            audio.close()

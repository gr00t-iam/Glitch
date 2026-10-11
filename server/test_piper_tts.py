import io
import base64
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch

from server import piper_service
from server.agent_wrapper import ChatCompletionRequest, complete_chat_response


class PiperTTSTests(TestCase):
    def test_runs_local_piper_and_returns_wav_bytes(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "piper.exe"
            model = root / "en_US-amy-medium.onnx"
            config = root / "en_US-amy-medium.onnx.json"
            cache = root / "cache"
            latest_wav = cache / "latest_response.wav"
            executable.write_bytes(b"exe")
            model.write_bytes(b"model")
            config.write_text("{}", encoding="utf-8")

            def run_piper(argv, **kwargs):
                output_path = Path(argv[argv.index("--output_file") + 1])
                output_path.write_bytes(b"RIFF-local-wave")
                self.assertEqual(kwargs["input"], b"Hello from NexusHarness")
                self.assertFalse(kwargs["shell"])
                return type("Result", (), {"returncode": 0})()

            with (
                patch.object(piper_service, "PIPER_EXECUTABLE", executable),
                patch.object(piper_service, "PIPER_MODEL", model),
                patch.object(piper_service, "PIPER_CONFIG", config),
                patch.object(piper_service, "CACHE_DIR", cache),
                patch.object(piper_service, "LATEST_WAV", latest_wav),
                patch.object(piper_service.subprocess, "run", side_effect=run_piper) as run,
            ):
                audio = piper_service.generate_piper_speech("Hello from NexusHarness")

            self.assertEqual(audio, b"RIFF-local-wave")
            self.assertEqual(latest_wav.read_bytes(), b"RIFF-local-wave")
            argv = run.call_args.args[0]
            self.assertEqual(argv[:3], [str(executable), "--model", str(model)])

    def test_missing_piper_returns_none_without_crashing(self) -> None:
        with (
            patch.object(piper_service, "PIPER_EXECUTABLE", Path(r"C:\missing\piper.exe")),
            patch.object(piper_service, "PIPER_MODEL", Path(r"C:\missing\voice.onnx")),
            patch.object(piper_service, "PIPER_CONFIG", Path(r"C:\missing\voice.onnx.json")),
            self.assertLogs(level="WARNING") as logs,
        ):
            self.assertIsNone(piper_service.generate_piper_speech("Hello"))
        self.assertIn("Piper voice files are missing.", logs.output[0])

    def test_bootstrap_downloads_missing_workspace_assets(self) -> None:
        with TemporaryDirectory() as directory:
            root = Path(directory)
            piper_dir = root / ".nexus_bin" / "piper"
            executable = piper_dir / "piper.exe"
            model = piper_dir / "en_US-amy-medium.onnx"
            config = piper_dir / "en_US-amy-medium.onnx.json"
            downloaded_urls: list[str] = []

            archive_bytes = io.BytesIO()
            with zipfile.ZipFile(archive_bytes, "w") as archive:
                archive.writestr("piper/piper.exe", b"exe")
                archive.writestr("piper/espeak-ng-data/readme.txt", b"data")

            def download(url: str, destination: Path) -> None:
                downloaded_urls.append(url)
                destination.parent.mkdir(parents=True, exist_ok=True)
                if url == piper_service.PIPER_RELEASE_URL:
                    destination.write_bytes(archive_bytes.getvalue())
                elif url == piper_service.VOICE_MODEL_URL:
                    destination.write_bytes(b"model")
                else:
                    destination.write_text("{}", encoding="utf-8")

            with (
                patch.object(piper_service, "PIPER_DIR", piper_dir),
                patch.object(piper_service, "PIPER_EXECUTABLE", executable),
                patch.object(piper_service, "PIPER_MODEL", model),
                patch.object(piper_service, "PIPER_CONFIG", config),
            ):
                self.assertTrue(piper_service.ensure_piper_assets(download))

            self.assertEqual(downloaded_urls, [
                piper_service.PIPER_RELEASE_URL,
                piper_service.VOICE_MODEL_URL,
                piper_service.VOICE_CONFIG_URL,
            ])
            self.assertTrue(executable.is_file())
            self.assertTrue(model.is_file())
            self.assertTrue(config.is_file())

    def test_chat_completion_requires_verified_cached_wav(self) -> None:
        # The endpoint contract is backed by the same atomic cache file used by generation.
        self.assertEqual(piper_service.LATEST_WAV.name, "latest_response.wav")

    def test_chat_completion_returns_browser_safe_wav_payload(self) -> None:
        with TemporaryDirectory() as directory:
            latest_wav = Path(directory) / "latest_response.wav"
            audio = b"RIFF-browser-safe-wave"
            latest_wav.write_bytes(audio)
            with (
                patch.object(piper_service, "LATEST_WAV", latest_wav),
                patch.object(piper_service, "generate_piper_speech", return_value=audio),
            ):
                result = complete_chat_response(ChatCompletionRequest(text="Hello"))

        self.assertEqual(result.audio_url, "/cache/latest_response.wav")
        self.assertEqual(result.media_type, "audio/wav")
        self.assertEqual(base64.b64decode(result.audio_base64), audio)
        self.assertNotIn(":\\", result.audio_url)

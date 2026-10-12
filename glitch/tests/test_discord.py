import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import discord

from glitch.discord_bot import DiscordGateway
from glitch.engine import AgentEngine
from glitch.storage import Store
from glitch.tests.context_fixtures import ContextModelFixture


class Worker(ContextModelFixture):
    def chat(self, settings, messages, cancel):
        if messages[-1]['content'].startswith('Verified tool result'):
            return {'message': 'Remote note saved.', 'tool': None, 'done': True}
        return {'message': 'Preparing the note.', 'done': False,
                'tool': {'name': 'write_file', 'args': {'path': 'remote.txt', 'content': 'Discord approval test'}}}


class DiscordTests(unittest.TestCase):
    def test_owner_only_remote_task_uses_same_approval_and_streams_final_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = Store(root / 'data')
            store.new_session(directory)
            settings = store.save_settings({'discord_user_id': '123456789012345678', 'worker_model': 'fixture'})
            engine = AgentEngine(store, Worker())
            gateway = DiscordGateway(store, engine)
            channel = MagicMock(spec=discord.DMChannel)
            channel.id = 123456789012345679
            channel.send = AsyncMock()
            owner = SimpleNamespace(id=123456789012345678, bot=False)
            stranger = SimpleNamespace(id=123456789012345670, bot=False)
            async def exercise(client, token, reconnect=True):
                await client.on_message(SimpleNamespace(author=stranger, channel=channel, content='!task Do something'))
                self.assertEqual(channel.send.await_count, 0)
                await client.on_message(SimpleNamespace(author=owner, channel=channel, content='!task Create a note'))
                view = None
                for _ in range(100):
                    for call in channel.send.await_args_list:
                        if call.kwargs.get('view'):
                            view = call.kwargs['view']
                    if view:
                        break
                    await asyncio.sleep(0.05)
                self.assertIsNotNone(view)
                self.assertFalse((root / 'remote.txt').exists())
                denied_interaction = SimpleNamespace(user=stranger, channel_id=channel.id)
                self.assertFalse(await view.interaction_check(denied_interaction))
                interaction = SimpleNamespace(user=owner, channel_id=channel.id,
                    response=SimpleNamespace(edit_message=AsyncMock(), send_message=AsyncMock()))
                self.assertTrue(await view.interaction_check(interaction))
                await view.children[0].callback(interaction)
                for _ in range(100):
                    if any('Remote note saved.' in str(call.args) for call in channel.send.await_args_list):
                        break
                    await asyncio.sleep(0.05)
                self.assertEqual((root / 'remote.txt').read_text(), 'Discord approval test')
                self.assertTrue(any('Remote note saved.' in str(call.args) for call in channel.send.await_args_list))
            with patch.object(discord.Client, 'start', exercise):
                gateway._run(settings, 'fixture-token-never-sent')
            self.assertIsNone(engine.state()['running_session'])


if __name__ == '__main__':
    unittest.main()

"""One-owner Discord gateway sharing the exact desktop runtime and approval gate."""

import asyncio
import io
import threading
from pathlib import Path


def authorized(user_id, channel_id, owner_id, allowed_channel, is_dm):
    return str(user_id) == owner_id and (str(channel_id) == allowed_channel if allowed_channel else is_dm)


class DiscordGateway:
    def __init__(self, store, engine):
        self.store, self.engine = store, engine
        self._lock = threading.RLock()
        self._state = {'connected': False, 'message': 'Discord is disconnected'}
        self._thread = None
        self._loop = None
        self._client = None
        self._active_session = None
        self._remote_sessions = set()
        self._stop_requested = threading.Event()

    def status(self):
        with self._lock:
            return dict(self._state)

    def _status(self, connected, message):
        with self._lock:
            self._state = {'connected': connected, 'message': message}

    def start(self):
        with self._lock:
            if self._thread and self._thread.is_alive():
                return self.status()
            settings = self.store.settings()
            token = self.store.discord_token()
            if not settings['discord_user_id'] or not token:
                raise ValueError('Save your Discord User ID and bot token first.')
            self._status(False, 'Connecting to Discord...')
            self._stop_requested.clear()
            self._thread = threading.Thread(target=self._run, args=(settings, token), daemon=True)
            self._thread.start()
            return self.status()

    def stop(self):
        self._stop_requested.set()
        with self._lock:
            for session in list(self._remote_sessions):
                self._stop_session(session)
            if not self._remote_sessions and self._active_session:
                self._stop_session(self._active_session)
            if self._loop and self._client and self._loop.is_running():
                asyncio.run_coroutine_threadsafe(self._client.close(), self._loop)
        self._status(False, 'Discord is disconnected')

    def _is_active(self, session):
        return self.engine.active_session(session) if hasattr(self.engine, 'active_session') else self.engine.state()['running_session'] == session

    def _stop_session(self, session):
        if self._is_active(session):
            if hasattr(self.engine, 'active_session'):
                self.engine.stop(session)
            else:
                self.engine.stop()

    def _run(self, settings, token):
        import discord
        gateway = self
        def allowed(user, channel):
            if not authorized(user.id, channel.id, settings['discord_user_id'], settings['discord_channel_id'], isinstance(channel, discord.DMChannel)):
                return False
            if isinstance(channel, discord.TextChannel) and channel.permissions_for(channel.guild.default_role).view_channel:
                return False
            return isinstance(channel, (discord.TextChannel, discord.DMChannel))

        class ApprovalView(discord.ui.View):
            def __init__(self, approval, channel):
                super().__init__(timeout=300)
                self.approval = approval
                self.channel = channel

            async def interaction_check(self, interaction):
                return allowed(interaction.user, self.channel) and interaction.channel_id == self.channel.id

            async def finish(self, interaction, answer):
                try:
                    gateway.engine.resolve_approval(self.approval['id'], answer)
                    for child in self.children:
                        child.disabled = True
                    await interaction.response.edit_message(content='Action approved.' if answer else 'Action denied. Glitch will revise the plan.', view=self)
                except ValueError:
                    await interaction.response.send_message('This action is no longer pending.', ephemeral=True)
                self.stop()

            @discord.ui.button(label='Approve Action', style=discord.ButtonStyle.success)
            async def approve(self, interaction, button):
                await self.finish(interaction, True)

            @discord.ui.button(label='Abort & Rewrite', style=discord.ButtonStyle.danger)
            async def deny(self, interaction, button):
                await self.finish(interaction, False)

        intents = discord.Intents.default()
        intents.message_content = True
        class Client(discord.Client):
            async def on_ready(self):
                gateway._status(True, f'Connected as {self.user.name}; only your User ID can issue commands')

            async def on_disconnect(self):
                gateway._status(False, 'Discord connection interrupted; reconnecting...')

            async def on_resumed(self):
                gateway._status(True, 'Discord connection restored')

            async def on_message(self, message):
                if message.author.bot or not allowed(message.author, message.channel):
                    return
                content = message.content.strip()
                if content == '!status':
                    state = gateway.engine.state()
                    await message.channel.send('Glitch is working.' if state['running_session'] else 'Glitch is ready.', allowed_mentions=discord.AllowedMentions.none())
                    return
                if content == '!stop':
                    for session in list(gateway._remote_sessions):
                        gateway._stop_session(session)
                    await message.channel.send('Stopping Glitch; pending approvals are denied.')
                    return
                if not content.startswith('!task '):
                    await message.channel.send('Use `!task <instructions>`, `!status`, or `!stop`. Choose your project in the desktop app first.')
                    return
                sessions = gateway.store.sessions()
                if not sessions:
                    await message.channel.send('Choose a project folder in the Glitch desktop app first.')
                    return
                if gateway.engine.state()['running_session'] and not hasattr(gateway.engine, 'active_session'):
                    await message.channel.send('Glitch already has an active task. Use `!stop` before assigning another.')
                    return
                session = gateway.store.new_session(sessions[0]['workspace'])
                try:
                    gateway.engine.start(session, content[6:])
                except ValueError as error:
                    await message.channel.send(str(error), allowed_mentions=discord.AllowedMentions.none())
                    return
                gateway._active_session = session
                gateway._remote_sessions.add(session)
                access = 'Full Access is on; supported actions run without approval prompts.' if gateway.store.settings().get('full_access') else 'Risky actions will wait for your approval here or in the desktop app.'
                await message.channel.send('Glitch accepted your task. ' + access)
                asyncio.create_task(self.stream(session, message.channel))

            async def stream(self, session, channel):
                cursor, approval_ids = 0, set()
                try:
                    while not self.is_closed():
                        events = gateway.store.events(session, cursor)
                        text = []
                        for event in events:
                            cursor = event['id']
                            payload, kind = event['payload'], event['kind']
                            if kind == 'approval' and payload['id'] not in approval_ids:
                                approval_ids.add(payload['id'])
                                import json
                                description = json.dumps(payload['payload'], indent=2)[:1300]
                                await channel.send(f"**{payload['action']} — approval required**\n```\n{description}\n```", view=ApprovalView(payload, channel), allowed_mentions=discord.AllowedMentions.none())
                            elif kind == 'capture':
                                path = Path(payload['path']).resolve()
                                if path.is_relative_to((gateway.store.directory / 'captures').resolve()) and path.is_file():
                                    from PIL import Image
                                    with Image.open(path) as image:
                                        image.thumbnail((1600, 1200))
                                        output = io.BytesIO()
                                        image.convert('RGB').save(output, 'JPEG', quality=80)
                                    output.seek(0)
                                    await channel.send('Approved capture', file=discord.File(output, filename='glitch-capture.jpg'))
                            elif kind in ('started', 'local', 'supervisor', 'browser', 'computer', 'correction', 'anchor', 'completed', 'stopped', 'paused', 'error', 'tool'):
                                text.append(event['title'])
                                if payload.get('directive'):
                                    text.append(payload['directive'])
                            elif kind == 'message':
                                text.append(payload['text'])
                            elif kind == 'output':
                                text.append(payload['text'][:300])
                        if text:
                            joined = '\n'.join(text)
                            for offset in range(0, min(len(joined), 10000), 1800):
                                await channel.send(joined[offset:offset + 1800], allowed_mentions=discord.AllowedMentions.none())
                        if not gateway._is_active(session) and not events:
                            break
                        await asyncio.sleep(1.5)
                except (discord.HTTPException, OSError):
                    gateway._stop_session(session)
                    gateway._status(False, 'Discord updates failed; the remote task was stopped safely.')
                finally:
                    gateway._remote_sessions.discard(session)
                    if gateway._active_session == session:
                        gateway._active_session = None

        async def listen():
            gateway._loop = asyncio.get_running_loop()
            async with Client(intents=intents) as client:
                gateway._client = client
                if not gateway._stop_requested.is_set():
                    await client.start(token, reconnect=True)
        try:
            asyncio.run(listen())
        except Exception:
            gateway._status(False, 'Discord could not connect. Check the bot token and Message Content Intent.')
        finally:
            gateway._loop = None
            gateway._client = None
            if gateway.status()['connected']:
                gateway._status(False, 'Discord is disconnected')

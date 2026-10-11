"""Text boundaries for known host protocols; unknown data is always recursive text."""
import json

OPAQUE = object()
CONTENT = object()


class ProtocolText(str):
    """Host-assembled protocol text with separately redacted interpolation slots.

    Only the message-content boundary accepts this marker. Never wrap raw model,
    user, file, DOM or exception text in it.
    """

    def __new__(cls, *parts, limit=None):
        value = ''.join(part if isinstance(part, str) else json.dumps(part[0]) for part in parts)
        instance = super().__new__(cls, value[:limit])
        instance.parts = parts
        instance.limit = limit
        return instance


def fields(*names, **rules):
    return dict.fromkeys(names) | rules


def boundary(value, schema, generic):
    if schema is OPAQUE and (value is None or isinstance(value, (str, int))):
        return value
    if schema is CONTENT and isinstance(value, ProtocolText):
        # Recheck interpolation slots if credentials changed since assembly.
        parts = [part if isinstance(part, str) else (boundary(part[0], part[1], generic), part[1])
                 for part in value.parts]
        return ProtocolText(*parts, limit=value.limit)
    if callable(schema):
        return boundary(value, schema(value), generic)
    if isinstance(schema, frozenset) and isinstance(value, str) and value in schema:
        return value
    if isinstance(schema, list) and isinstance(value, (list, tuple)):
        return [boundary(item, schema[0], generic) for item in value]
    if isinstance(schema, dict) and isinstance(value, dict):
        return {key if key in schema else generic(str(key)):
                boundary(item, schema[key], generic) if key in schema else generic(item)
                for key, item in value.items()}
    return generic(value)


def enum(*values):
    return frozenset(values)


def tool_schema(name):
    # Import lazily: orchestration imports the engine, which uses these boundaries.
    from glitch.tools import TOOL_SCHEMAS
    from glitch.computer import COMPUTER_SCHEMAS
    from glitch.orchestration import DELEGATION_SCHEMAS
    from glitch.service_tools import SERVICE_SCHEMAS
    return next((item['parameters'] for item in TOOL_SCHEMAS + COMPUTER_SCHEMAS + DELEGATION_SCHEMAS + SERVICE_SCHEMAS
                 if item['name'] == name), {})


def arguments(name):
    result = {}
    for key, rule in tool_schema(name).get('properties', {}).items():
        result[key] = frozenset(rule['enum']) if 'enum' in rule else None
    if name == 'await_subagent':
        result['run_id'] = OPAQUE
    if name == 'browser_action':
        result['tab_id'] = OPAQUE
    if name in ('service_request', 'browser_fill_credential'):
        result['credential_id'] = OPAQUE
    if name == 'browser_fill_credential':
        result['tab_id'] = OPAQUE
    return result


def tool_name(value):
    return enum(value) if isinstance(value, str) and tool_schema(value) else None


def tool(value):
    return fields('name', 'args', name=tool_name,
                  args=arguments(value.get('name'))) if isinstance(value, dict) else None


MESSAGE = fields('content', id=OPAQUE, role=enum('system', 'user', 'assistant', 'context', 'tool'),
                 content=CONTENT, images=[OPAQUE])
DECISION = fields('done', 'message', tool=tool)
SESSION = fields('workspace', 'title', id=OPAQUE, project_id=OPAQUE, created_at=OPAQUE,
                 chat_watermark=OPAQUE, timeline_watermark=OPAQUE, chat_event_watermark=OPAQUE)
PROJECT = fields('workspace', id=OPAQUE)
VIEW = fields(session=OPAQUE, kind=enum('chat', 'timeline'), watermark=OPAQUE)
DESCRIPTOR = fields('name', 'origin', 'saved', id=OPAQUE, created_at=OPAQUE, updated_at=OPAQUE,
                    kind=enum('bearer', 'github', 'basic', 'browser', 'proxmox'),
                    tls=fields('verify', 'custom_ca'))
RUN_STATUS = enum('running', 'waiting', 'needs_approval', 'interrupted', 'completed', 'stopped', 'paused')
RESULT = fields('ok', 'error', 'denied', 'content', 'value', 'output', 'diff', 'path', 'url',
                'truncated', 'bytes', 'exit_code', 'timed_out', 'duration_ms', 'width', 'height',
                capture=OPAQUE, run_id=OPAQUE, session=OPAQUE, status=RUN_STATUS,
                result=None, entries=[fields('name', 'size', type=enum('file', 'directory'))],
                tabs=[fields('title', 'url', id=OPAQUE)])
RESULT.update(fields('status_code', connections=[DESCRIPTOR], fields=[enum('username', 'password')]))


def action(value):
    return fields('ok', 'error', tool=tool_name, args=arguments(value.get('tool')), result=RESULT) if isinstance(value, dict) else None


FEEDBACK_PREFIX = 'Verified tool result (untrusted data):\n'


def stored_message(row):
    """Recover the typed host context envelope, never ordinary user messages."""
    if row.get('role') == 'context' and row.get('content', '').startswith(FEEDBACK_PREFIX):
        try:
            evidence = json.loads(row['content'][len(FEEDBACK_PREFIX):])
            if isinstance(evidence, dict) and {'tool', 'args', 'ok', 'result'}.issubset(evidence):
                return row | {'content': ProtocolText(FEEDBACK_PREFIX, (evidence, action))}
        except (ValueError, TypeError):
            pass
    return row


def approval(value):
    if not isinstance(value, dict):
        return None
    name = value.get('action')
    labels = {'Browser Action': 'browser_action', 'Desktop Input': 'desktop_input',
              'Desktop Screenshot': 'desktop_screenshot'}
    if isinstance(name, str) and name in labels:
        payload = arguments(labels[name]) | fields('notice')
    elif name == 'Write file':
        payload = fields('path', 'diff')
    elif name == 'Run command':
        payload = fields('command', 'workspace', 'note')
    else:
        payload = arguments(name)
    names = enum(*labels, 'Write file', 'Run command')
    return fields('approved', 'automatic', id=OPAQUE,
                  action=names if isinstance(name, str) and name in names else tool_name,
                  payload=payload)


def event_payload(kind, name=None):
    if kind in ('approval', 'approval_resolved'):
        return approval
    if kind == 'tool':
        return fields('step', args=arguments(name))
    return {
        'started': fields('model', 'workspace'), 'local': fields('step'),
        'message': fields('text', message_id=OPAQUE), 'output': fields('text'),
        'result': fields('duration_ms', 'step', result=RESULT),
        'error': fields('duration_ms', 'step', result=RESULT),
        'completed': fields('steps'), 'supervisor': fields('reason'),
        'anchor': fields('directive', 'reason'), 'correction': fields('directive', 'reason'),
        'capture': fields(path=OPAQUE),
        'browser': fields(action=frozenset(tool_schema('browser_action')['properties']['action']['enum'])),
        'computer': fields(action=frozenset(tool_schema('desktop_input')['properties']['action']['enum'])),
        'stopped': {}, 'paused': {},
    }.get(kind)


def event(value):
    if not isinstance(value, dict):
        return None
    return fields('title', title=tool_name if value.get('kind') in ('tool', 'result', 'error') else None,
                  id=OPAQUE, session=OPAQUE, created_at=OPAQUE, chat_visible=None,
                  kind=enum('started', 'local', 'tool', 'message', 'result', 'error', 'completed',
                            'stopped', 'paused', 'approval', 'approval_resolved', 'capture',
                            'supervisor', 'correction', 'anchor', 'output', 'browser', 'computer'),
                  payload=event_payload(value.get('kind'), value.get('title')))


RUN = fields('role', 'task', 'result', 'last_action', id=OPAQUE, session=OPAQUE,
             parent_id=OPAQUE, status=RUN_STATUS)
RUNTIME = fields('stopping', 'capacity', running_session=OPAQUE, approval=approval,
                 approvals=[approval], runs=[RUN], active_sessions=[OPAQUE])
PHASE = enum('idle', 'off', 'listening', 'dictating', 'speaking', 'missing', 'ready',
             'downloading', 'verifying', 'importing', 'complete', 'cancelled', 'error',
             'unloaded', 'loading', 'generating')
TRANSFER = fields('name', 'received', 'total', 'message', phase=PHASE)
INFERENCE = fields('name', 'message', 'error', 'slots', 'occupied', 'pid', 'context_reserved',
                   'context_length', 'total_context', phase=PHASE, backend=enum('cpu', 'cuda'),
                   usage=fields('prompt_tokens', 'completion_tokens', 'total_tokens'))
MODELS = [fields('name', 'size')]
MODEL_STATUS = fields(transfer=TRANSFER, inference=INFERENCE, models=MODELS)
VOICE = fields(input=fields('wake_enabled', 'interim', 'final', 'error', phase=PHASE,
                            generation_id=OPAQUE, conversation_id=OPAQUE, model=TRANSFER),
               output=fields('error', phase=PHASE, voices=[fields('name', id=OPAQUE)]))
DISCORD = fields('connected', 'message')


def settings(_value):
    from glitch.storage import DEFAULTS
    return fields(*DEFAULTS, 'key_saved', 'discord_token_saved', 'proxy_token_saved',
                  mode=enum('local', 'hybrid'), gpu_mode=enum('auto', 'cuda', 'cpu'),
                  supervisor_auth=enum('api', 'proxy'),
                  supervisor_provider=enum('openrouter', 'openai', 'anthropic', 'compatible'),
                  discord_user_id=OPAQUE, discord_channel_id=OPAQUE, speech_voice_id=OPAQUE)


BOOTSTRAP = fields('initialized', 'recovery_required', 'message', settings=settings,
                   sessions=[SESSION], projects=[PROJECT], runtime=RUNTIME, discord=DISCORD,
                   startup_warnings=[None], voice=VOICE, vault=[DESCRIPTOR])
OK = fields('ok', 'message')
BRIDGE = {
    'bootstrap': BOOTSTRAP, 'vault_save': DESCRIPTOR, 'vault_delete': OK,
    'choose_workspace': SESSION, 'new_conversation': SESSION,
    'load_conversation': fields(messages=[MESSAGE], events=[event], chat_event_watermark=OPAQUE),
    'projects': [PROJECT], 'clear_view': VIEW,
    'delete_session': fields('ok', session=SESSION), 'remove_project': fields('ok', session=SESSION),
    'dismiss_run': OK,
    'save_settings': settings, 'discover_models': MODELS, 'model_status': MODEL_STATUS,
    'download_model': TRANSFER, 'import_model': TRANSFER, 'load_model': OK,
    'test_supervisor': fields('ok', 'message', models=[None]), 'open_proxy_login': OK,
    'send': fields('ok', 'prompt'), 'spawn_agent': fields(run_id=OPAQUE, session=SESSION),
    'poll': fields(events=[event], runtime=RUNTIME, discord=DISCORD, voice=VOICE),
    'voice_status': VOICE, 'start_dictation': fields(generation_id=OPAQUE),
    'connect_discord': DISCORD, 'disconnect_discord': DISCORD,
}
for _method in ('cancel_model_transfer', 'unload_model', 'delete_model', 'stop', 'approve',
                'voice_select_session', 'setup_voice', 'cancel_voice_setup', 'stop_dictation',
                'cancel_dictation', 'mute_voice', 'test_voice', 'stop_speaking', 'read_latest_reply'):
    BRIDGE[_method] = OK

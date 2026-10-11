// AUTO-GENERATED skill catalog for the Glitch Skill Store.
// 100 production-ready, safety-constrained skills across 5 categories.
// Regenerate with scripts/genskills (see project notes). Edit entries here freely.
import type { MarketplaceSkill } from "../components/SkillStore";

export const marketplaceSkills: MarketplaceSkill[] = [
  {
    "id": "store_auto_chunker",
    "name": "Auto Chunker",
    "category": "Developer Utilities",
    "description": "Break oversized assistant responses into numbered parts with a Continue control for the next chunk.",
    "rating": 4.9,
    "installs": "Built-in",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "chunk",
      "continue",
      "long response",
      "token limit",
      "part"
    ],
    "systemPromptSnippet": "When an answer is long, keep each visible part below the configured response chunk limit. Label chunks as Part 1, Part 2, and so on. Continue from the exact previous point when the user asks for the next part.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [],
    "safety": [
      "Do not omit required content when chunking.",
      "Preserve citations, code blocks, and ordered steps as much as possible.",
      "Use continuation only for already-generated content unless the user asks for new work."
    ]
  },
  {
    "id": "store_process_monitor",
    "name": "Process Monitor",
    "category": "System & OS Management",
    "description": "List running processes with their CPU and memory use to find what is consuming resources.",
    "rating": 4.9,
    "installs": "3.2K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "process",
      "monitor",
      "processes",
      "top",
      "resource"
    ],
    "systemPromptSnippet": "List running processes with their CPU and memory use to find what is consuming resources. Parameters: filter (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "filter",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_kill_process",
    "name": "Kill Process",
    "category": "System & OS Management",
    "description": "Terminate a process by name or PID after confirming it is the correct one.",
    "rating": 4.8,
    "installs": "8.1K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "kill",
      "process",
      "terminate",
      "end",
      "pid"
    ],
    "systemPromptSnippet": "Terminate a process by name or PID after confirming it is the correct one. Parameters: target (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "target",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_service_status",
    "name": "Service Status",
    "category": "System & OS Management",
    "description": "Check whether a system service or daemon is running and report its state.",
    "rating": 4.7,
    "installs": "12K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "service",
      "status",
      "daemon",
      "running"
    ],
    "systemPromptSnippet": "Check whether a system service or daemon is running and report its state. Parameters: service (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "service",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_service_control",
    "name": "Service Control",
    "category": "System & OS Management",
    "description": "Start, stop, or restart a named system service with confirmation.",
    "rating": 4.6,
    "installs": "21K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "service",
      "control",
      "start",
      "stop",
      "restart"
    ],
    "systemPromptSnippet": "Start, stop, or restart a named system service with confirmation. Parameters: service (string, required); action (enum, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "service",
        "type": "string",
        "required": true
      },
      {
        "name": "action",
        "type": "enum",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_disk_space_check",
    "name": "Disk Space Check",
    "category": "System & OS Management",
    "description": "Report free and used space for each drive or mount point.",
    "rating": 4.5,
    "installs": "5.6K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "disk",
      "space",
      "check",
      "storage",
      "free",
      "drive"
    ],
    "systemPromptSnippet": "Report free and used space for each drive or mount point. Parameters: path (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_memory_usage",
    "name": "Memory Usage",
    "category": "System & OS Management",
    "description": "Show total, used, and available RAM plus the top memory consumers.",
    "rating": 4.9,
    "installs": "9.4K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "memory",
      "usage",
      "ram"
    ],
    "systemPromptSnippet": "Show total, used, and available RAM plus the top memory consumers. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_cpu_load",
    "name": "CPU Load",
    "category": "System & OS Management",
    "description": "Report current CPU utilization and recent load averages.",
    "rating": 4.8,
    "installs": "15K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "cpu",
      "load",
      "usage"
    ],
    "systemPromptSnippet": "Report current CPU utilization and recent load averages. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_startup_programs",
    "name": "Startup Programs",
    "category": "System & OS Management",
    "description": "List the applications configured to launch at login or boot.",
    "rating": 4.7,
    "installs": "2.7K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "startup",
      "programs",
      "autostart",
      "boot",
      "login"
    ],
    "systemPromptSnippet": "List the applications configured to launch at login or boot. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_scheduled_tasks",
    "name": "Scheduled Tasks",
    "category": "System & OS Management",
    "description": "List scheduled tasks or cron jobs and when they next run.",
    "rating": 4.6,
    "installs": "18K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "scheduled",
      "tasks",
      "cron",
      "schedule",
      "jobs"
    ],
    "systemPromptSnippet": "List scheduled tasks or cron jobs and when they next run. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_environment_variables",
    "name": "Environment Variables",
    "category": "System & OS Management",
    "description": "Read or list environment variables, masking anything that looks secret.",
    "rating": 4.5,
    "installs": "6.3K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "environment",
      "variables",
      "env",
      "path"
    ],
    "systemPromptSnippet": "Read or list environment variables, masking anything that looks secret. Parameters: name (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "name",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_system_uptime",
    "name": "System Uptime",
    "category": "System & OS Management",
    "description": "Report how long the machine has been running since last boot.",
    "rating": 4.9,
    "installs": "11K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "system",
      "uptime",
      "boot",
      "running"
    ],
    "systemPromptSnippet": "Report how long the machine has been running since last boot. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_installed_apps",
    "name": "Installed Apps",
    "category": "System & OS Management",
    "description": "List installed applications or packages on this machine.",
    "rating": 4.8,
    "installs": "24K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "installed",
      "apps",
      "packages",
      "software"
    ],
    "systemPromptSnippet": "List installed applications or packages on this machine. Parameters: filter (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "filter",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_battery_status",
    "name": "Battery Status",
    "category": "System & OS Management",
    "description": "Report battery percentage and whether the device is charging.",
    "rating": 4.7,
    "installs": "4.1K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "battery",
      "status",
      "power",
      "charge"
    ],
    "systemPromptSnippet": "Report battery percentage and whether the device is charging. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_clipboard_reader",
    "name": "Clipboard Reader",
    "category": "System & OS Management",
    "description": "Read the current clipboard text when the user asks.",
    "rating": 4.6,
    "installs": "7.7K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "clipboard",
      "reader",
      "copy",
      "paste"
    ],
    "systemPromptSnippet": "Read the current clipboard text when the user asks. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_screenshot_capture",
    "name": "Screenshot Capture",
    "category": "System & OS Management",
    "description": "Capture the screen to an image file saved inside the workspace.",
    "rating": 4.5,
    "installs": "19K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "screenshot",
      "capture",
      "screen"
    ],
    "systemPromptSnippet": "Capture the screen to an image file saved inside the workspace. Parameters: outputPath (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "outputPath",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_window_manager",
    "name": "Window Manager",
    "category": "System & OS Management",
    "description": "List open windows and focus, minimize, or close a chosen one.",
    "rating": 4.9,
    "installs": "9.9K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "window",
      "manager",
      "windows",
      "focus",
      "minimize"
    ],
    "systemPromptSnippet": "List open windows and focus, minimize, or close a chosen one. Parameters: title (string, optional); action (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "title",
        "type": "string",
        "required": false
      },
      {
        "name": "action",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_user_account_info",
    "name": "User Account Info",
    "category": "System & OS Management",
    "description": "Show the current user, their groups, and whether they have admin rights.",
    "rating": 4.8,
    "installs": "13K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "user",
      "account",
      "info",
      "admin"
    ],
    "systemPromptSnippet": "Show the current user, their groups, and whether they have admin rights. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_system_info_report",
    "name": "System Info Report",
    "category": "System & OS Management",
    "description": "Summarize OS, CPU, RAM, and hostname in one report.",
    "rating": 4.7,
    "installs": "6.8K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "system",
      "info",
      "report",
      "sysinfo",
      "specs",
      "hostname"
    ],
    "systemPromptSnippet": "Summarize OS, CPU, RAM, and hostname in one report. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_power_control",
    "name": "Power Control",
    "category": "System & OS Management",
    "description": "Sleep, restart, or shut down the machine only after explicit confirmation.",
    "rating": 4.6,
    "installs": "16K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "power",
      "control",
      "shutdown",
      "restart",
      "sleep"
    ],
    "systemPromptSnippet": "Sleep, restart, or shut down the machine only after explicit confirmation. Parameters: action (enum, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "action",
        "type": "enum",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_network_adapter_status",
    "name": "Network Adapter Status",
    "category": "System & OS Management",
    "description": "List network interfaces and whether each is up or down.",
    "rating": 4.5,
    "installs": "5.2K",
    "screenshotTone": "blue",
    "triggerKeywords": [
      "network",
      "adapter",
      "status",
      "interface",
      "nic"
    ],
    "systemPromptSnippet": "List network interfaces and whether each is up or down. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_file_hasher",
    "name": "File Hasher",
    "category": "File & Data Operations",
    "description": "Compute the SHA-256 (or chosen algorithm) hash of a file to verify integrity.",
    "rating": 4.9,
    "installs": "3.2K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "file",
      "hasher",
      "hash",
      "checksum",
      "sha256"
    ],
    "systemPromptSnippet": "Compute the SHA-256 (or chosen algorithm) hash of a file to verify integrity. Parameters: path (path, required); algorithm (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "algorithm",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_batch_renamer",
    "name": "Batch Renamer",
    "category": "File & Data Operations",
    "description": "Rename many files by a pattern, showing a dry-run preview first.",
    "rating": 4.8,
    "installs": "8.1K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "batch",
      "renamer",
      "rename",
      "bulk",
      "pattern"
    ],
    "systemPromptSnippet": "Rename many files by a pattern, showing a dry-run preview first. Parameters: folder (path, required); pattern (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "folder",
        "type": "path",
        "required": true
      },
      {
        "name": "pattern",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_regex_extractor",
    "name": "Regex Extractor",
    "category": "File & Data Operations",
    "description": "Extract every match of a regular expression from a text file.",
    "rating": 4.7,
    "installs": "12K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "regex",
      "extractor",
      "extract",
      "match"
    ],
    "systemPromptSnippet": "Extract every match of a regular expression from a text file. Parameters: path (path, required); pattern (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "pattern",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_folder_compressor",
    "name": "Folder Compressor",
    "category": "File & Data Operations",
    "description": "Compress a folder into a zip archive.",
    "rating": 4.6,
    "installs": "21K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "folder",
      "compressor",
      "zip",
      "compress",
      "archive"
    ],
    "systemPromptSnippet": "Compress a folder into a zip archive. Parameters: folder (path, required); outputPath (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "folder",
        "type": "path",
        "required": true
      },
      {
        "name": "outputPath",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_archive_extractor",
    "name": "Archive Extractor",
    "category": "File & Data Operations",
    "description": "Safely extract a zip or tar archive, rejecting entries that escape the target folder.",
    "rating": 4.5,
    "installs": "5.6K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "archive",
      "extractor",
      "unzip",
      "extract"
    ],
    "systemPromptSnippet": "Safely extract a zip or tar archive, rejecting entries that escape the target folder. Parameters: archive (path, required); destination (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "archive",
        "type": "path",
        "required": true
      },
      {
        "name": "destination",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_duplicate_finder",
    "name": "Duplicate Finder",
    "category": "File & Data Operations",
    "description": "Find duplicate files by content hash within a folder.",
    "rating": 4.9,
    "installs": "9.4K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "duplicate",
      "finder",
      "duplicates",
      "dupe",
      "hash"
    ],
    "systemPromptSnippet": "Find duplicate files by content hash within a folder. Parameters: folder (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "folder",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_bulk_mover",
    "name": "Bulk Mover",
    "category": "File & Data Operations",
    "description": "Move or copy files matching a glob into a target folder.",
    "rating": 4.8,
    "installs": "15K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "bulk",
      "mover",
      "move",
      "copy",
      "glob"
    ],
    "systemPromptSnippet": "Move or copy files matching a glob into a target folder. Parameters: source (string, required); destination (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "source",
        "type": "string",
        "required": true
      },
      {
        "name": "destination",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_large_file_finder",
    "name": "Large File Finder",
    "category": "File & Data Operations",
    "description": "List the largest files under a chosen path.",
    "rating": 4.7,
    "installs": "2.7K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "large",
      "file",
      "finder",
      "big",
      "space"
    ],
    "systemPromptSnippet": "List the largest files under a chosen path. Parameters: path (path, required); limit (number, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "limit",
        "type": "number",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_content_search",
    "name": "Content Search",
    "category": "File & Data Operations",
    "description": "Search file contents for a string or regex, grep-style.",
    "rating": 4.6,
    "installs": "18K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "content",
      "search",
      "grep",
      "find"
    ],
    "systemPromptSnippet": "Search file contents for a string or regex, grep-style. Parameters: path (path, required); query (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "query",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_csv_cleaner",
    "name": "CSV Cleaner",
    "category": "File & Data Operations",
    "description": "Trim whitespace, drop duplicate rows, and normalize a CSV file.",
    "rating": 4.5,
    "installs": "6.3K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "csv",
      "cleaner",
      "clean",
      "normalize"
    ],
    "systemPromptSnippet": "Trim whitespace, drop duplicate rows, and normalize a CSV file. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_json_formatter",
    "name": "JSON Formatter",
    "category": "File & Data Operations",
    "description": "Pretty-print or minify a JSON file.",
    "rating": 4.9,
    "installs": "11K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "json",
      "formatter",
      "format",
      "pretty"
    ],
    "systemPromptSnippet": "Pretty-print or minify a JSON file. Parameters: path (path, required); mode (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "mode",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_encoding_converter",
    "name": "Encoding Converter",
    "category": "File & Data Operations",
    "description": "Convert a text file between encodings, for example to UTF-8.",
    "rating": 4.8,
    "installs": "24K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "encoding",
      "converter",
      "utf8",
      "convert"
    ],
    "systemPromptSnippet": "Convert a text file between encodings, for example to UTF-8. Parameters: path (path, required); target (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "target",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_file_encryptor",
    "name": "File Encryptor",
    "category": "File & Data Operations",
    "description": "Encrypt a file with a passphrase using AES-GCM.",
    "rating": 4.7,
    "installs": "4.1K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "file",
      "encryptor",
      "encrypt",
      "aes",
      "secure"
    ],
    "systemPromptSnippet": "Encrypt a file with a passphrase using AES-GCM. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_secure_delete",
    "name": "Secure Delete",
    "category": "File & Data Operations",
    "description": "Overwrite and delete a file after explicit confirmation.",
    "rating": 4.6,
    "installs": "7.7K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "secure",
      "delete",
      "shred",
      "wipe"
    ],
    "systemPromptSnippet": "Overwrite and delete a file after explicit confirmation. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_folder_size_report",
    "name": "Folder Size Report",
    "category": "File & Data Operations",
    "description": "Report total size and file count of a folder tree.",
    "rating": 4.5,
    "installs": "19K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "folder",
      "size",
      "report"
    ],
    "systemPromptSnippet": "Report total size and file count of a folder tree. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_metadata_reader",
    "name": "Metadata Reader",
    "category": "File & Data Operations",
    "description": "Read a file's timestamps, size, and permissions.",
    "rating": 4.9,
    "installs": "9.9K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "metadata",
      "reader",
      "stat",
      "info"
    ],
    "systemPromptSnippet": "Read a file's timestamps, size, and permissions. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_image_resizer",
    "name": "Image Resizer",
    "category": "File & Data Operations",
    "description": "Resize or convert an image to the requested dimensions.",
    "rating": 4.8,
    "installs": "13K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "image",
      "resizer",
      "resize",
      "convert"
    ],
    "systemPromptSnippet": "Resize or convert an image to the requested dimensions. Parameters: path (path, required); width (number, optional); height (number, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "width",
        "type": "number",
        "required": false
      },
      {
        "name": "height",
        "type": "number",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_pdf_toolkit",
    "name": "PDF Toolkit",
    "category": "File & Data Operations",
    "description": "Split or merge PDF pages.",
    "rating": 4.7,
    "installs": "6.8K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "pdf",
      "toolkit",
      "split",
      "merge"
    ],
    "systemPromptSnippet": "Split or merge PDF pages. Parameters: path (path, required); action (enum, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      },
      {
        "name": "action",
        "type": "enum",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_text_deduper",
    "name": "Text Deduper",
    "category": "File & Data Operations",
    "description": "Remove duplicate lines from a text file.",
    "rating": 4.6,
    "installs": "16K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "text",
      "deduper",
      "dedupe",
      "unique",
      "lines"
    ],
    "systemPromptSnippet": "Remove duplicate lines from a text file. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_line_counter",
    "name": "Line Counter",
    "category": "File & Data Operations",
    "description": "Count lines, words, and characters in one or more files.",
    "rating": 4.5,
    "installs": "5.2K",
    "screenshotTone": "mint",
    "triggerKeywords": [
      "line",
      "counter",
      "count",
      "lines",
      "words"
    ],
    "systemPromptSnippet": "Count lines, words, and characters in one or more files. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_ping_host",
    "name": "Ping Host",
    "category": "Network & Diagnostics",
    "description": "Measure reachability and latency to a host you are authorized to test.",
    "rating": 4.9,
    "installs": "3.2K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "ping",
      "host",
      "latency",
      "reach"
    ],
    "systemPromptSnippet": "Measure reachability and latency to a host you are authorized to test. Parameters: host (string, required); count (number, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "host",
        "type": "string",
        "required": true
      },
      {
        "name": "count",
        "type": "number",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_traceroute",
    "name": "Traceroute",
    "category": "Network & Diagnostics",
    "description": "Trace the network path and hops to a host.",
    "rating": 4.8,
    "installs": "8.1K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "traceroute",
      "tracert",
      "hops"
    ],
    "systemPromptSnippet": "Trace the network path and hops to a host. Parameters: host (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "host",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_port_reachability",
    "name": "Port Reachability",
    "category": "Network & Diagnostics",
    "description": "Check whether a single TCP port on an authorized host is open.",
    "rating": 4.7,
    "installs": "12K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "port",
      "reachability",
      "tcp",
      "open"
    ],
    "systemPromptSnippet": "Check whether a single TCP port on an authorized host is open. Parameters: host (string, required); port (number, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "host",
        "type": "string",
        "required": true
      },
      {
        "name": "port",
        "type": "number",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_dns_lookup",
    "name": "DNS Lookup",
    "category": "Network & Diagnostics",
    "description": "Resolve a hostname's A and AAAA records.",
    "rating": 4.6,
    "installs": "21K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "dns",
      "lookup",
      "resolve"
    ],
    "systemPromptSnippet": "Resolve a hostname's A and AAAA records. Parameters: hostname (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "hostname",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_reverse_dns",
    "name": "Reverse DNS",
    "category": "Network & Diagnostics",
    "description": "Resolve an IP address back to a hostname.",
    "rating": 4.5,
    "installs": "5.6K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "reverse",
      "dns",
      "ptr"
    ],
    "systemPromptSnippet": "Resolve an IP address back to a hostname. Parameters: ip (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "ip",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_public_ip",
    "name": "Public IP",
    "category": "Network & Diagnostics",
    "description": "Report this machine's public IP address.",
    "rating": 4.9,
    "installs": "9.4K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "public",
      "whatismyip"
    ],
    "systemPromptSnippet": "Report this machine's public IP address. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_local_interfaces",
    "name": "Local Interfaces",
    "category": "Network & Diagnostics",
    "description": "List local IP addresses and network interfaces.",
    "rating": 4.8,
    "installs": "15K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "local",
      "interfaces"
    ],
    "systemPromptSnippet": "List local IP addresses and network interfaces. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_http_fetch",
    "name": "HTTP Fetch",
    "category": "Network & Diagnostics",
    "description": "Perform a safe GET request and show the status and a body snippet.",
    "rating": 4.7,
    "installs": "2.7K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "http",
      "fetch",
      "get"
    ],
    "systemPromptSnippet": "Perform a safe GET request and show the status and a body snippet. Parameters: url (url, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_header_inspector",
    "name": "Header Inspector",
    "category": "Network & Diagnostics",
    "description": "Fetch a URL and display its HTTP response headers.",
    "rating": 4.6,
    "installs": "18K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "header",
      "inspector",
      "headers",
      "http",
      "inspect"
    ],
    "systemPromptSnippet": "Fetch a URL and display its HTTP response headers. Parameters: url (url, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_ssl_cert_check",
    "name": "SSL Cert Check",
    "category": "Network & Diagnostics",
    "description": "Show a site's TLS certificate issuer and expiry date.",
    "rating": 4.5,
    "installs": "6.3K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "ssl",
      "cert",
      "check",
      "tls",
      "certificate"
    ],
    "systemPromptSnippet": "Show a site's TLS certificate issuer and expiry date. Parameters: host (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "host",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_latency_monitor",
    "name": "Latency Monitor",
    "category": "Network & Diagnostics",
    "description": "Sample latency to a host repeatedly over a short window.",
    "rating": 4.9,
    "installs": "11K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "latency",
      "monitor",
      "jitter"
    ],
    "systemPromptSnippet": "Sample latency to a host repeatedly over a short window. Parameters: host (string, required); samples (number, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "host",
        "type": "string",
        "required": true
      },
      {
        "name": "samples",
        "type": "number",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_whois_lookup",
    "name": "WHOIS Lookup",
    "category": "Network & Diagnostics",
    "description": "Look up domain registration information.",
    "rating": 4.8,
    "installs": "24K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "whois",
      "lookup",
      "domain",
      "registrar"
    ],
    "systemPromptSnippet": "Look up domain registration information. Parameters: domain (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "domain",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_mac_vendor_lookup",
    "name": "MAC Vendor Lookup",
    "category": "Network & Diagnostics",
    "description": "Identify a network card vendor from a MAC address.",
    "rating": 4.7,
    "installs": "4.1K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "mac",
      "vendor",
      "lookup",
      "oui"
    ],
    "systemPromptSnippet": "Identify a network card vendor from a MAC address. Parameters: mac (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "mac",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_wi_fi_info",
    "name": "Wi-Fi Info",
    "category": "Network & Diagnostics",
    "description": "Show the connected Wi-Fi network name and signal strength.",
    "rating": 4.6,
    "installs": "7.7K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "info",
      "wifi",
      "ssid",
      "signal"
    ],
    "systemPromptSnippet": "Show the connected Wi-Fi network name and signal strength. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_open_connections",
    "name": "Open Connections",
    "category": "Network & Diagnostics",
    "description": "List active network connections, netstat-style.",
    "rating": 4.5,
    "installs": "19K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "open",
      "connections",
      "netstat",
      "sockets"
    ],
    "systemPromptSnippet": "List active network connections, netstat-style. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_file_downloader",
    "name": "File Downloader",
    "category": "Network & Diagnostics",
    "description": "Download a file from an allowlisted URL into the workspace.",
    "rating": 4.9,
    "installs": "9.9K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "file",
      "downloader",
      "download",
      "fetch",
      "wget"
    ],
    "systemPromptSnippet": "Download a file from an allowlisted URL into the workspace. Parameters: url (url, required); outputPath (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      },
      {
        "name": "outputPath",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_url_status_check",
    "name": "URL Status Check",
    "category": "Network & Diagnostics",
    "description": "Check whether a URL is up and report its response code.",
    "rating": 4.8,
    "installs": "13K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "url",
      "status",
      "check",
      "uptime"
    ],
    "systemPromptSnippet": "Check whether a URL is up and report its response code. Parameters: url (url, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_webhook_tester",
    "name": "Webhook Tester",
    "category": "Network & Diagnostics",
    "description": "Send a test payload to a webhook URL you control.",
    "rating": 4.7,
    "installs": "6.8K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "webhook",
      "tester",
      "test",
      "post"
    ],
    "systemPromptSnippet": "Send a test payload to a webhook URL you control. Parameters: url (url, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_rest_api_caller",
    "name": "REST API Caller",
    "category": "Network & Diagnostics",
    "description": "Call a REST endpoint with a chosen method, headers, and body.",
    "rating": 4.6,
    "installs": "16K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "rest",
      "api",
      "caller",
      "request"
    ],
    "systemPromptSnippet": "Call a REST endpoint with a chosen method, headers, and body. Parameters: url (url, required); method (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      },
      {
        "name": "method",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_speedtest_helper",
    "name": "Speedtest Helper",
    "category": "Network & Diagnostics",
    "description": "Guide running a bandwidth speed test and summarize the result.",
    "rating": 4.5,
    "installs": "5.2K",
    "screenshotTone": "violet",
    "triggerKeywords": [
      "speedtest",
      "helper",
      "bandwidth",
      "speed"
    ],
    "systemPromptSnippet": "Guide running a bandwidth speed test and summarize the result. Parameters: none. Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_git_status",
    "name": "Git Status",
    "category": "Developer Utilities",
    "description": "Summarize the working-tree changes in a git repository.",
    "rating": 4.9,
    "installs": "3.2K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "git",
      "status",
      "changes"
    ],
    "systemPromptSnippet": "Summarize the working-tree changes in a git repository. Parameters: repo (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "repo",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_git_diff_summary",
    "name": "Git Diff Summary",
    "category": "Developer Utilities",
    "description": "Summarize staged and unstaged diffs in plain language.",
    "rating": 4.8,
    "installs": "8.1K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "git",
      "diff",
      "summary",
      "review"
    ],
    "systemPromptSnippet": "Summarize staged and unstaged diffs in plain language. Parameters: repo (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "repo",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_json_validator",
    "name": "JSON Validator",
    "category": "Developer Utilities",
    "description": "Validate JSON and point to the exact syntax error.",
    "rating": 4.7,
    "installs": "12K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "json",
      "validator",
      "validate",
      "lint"
    ],
    "systemPromptSnippet": "Validate JSON and point to the exact syntax error. Parameters: path (path, optional); text (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": false
      },
      {
        "name": "text",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_yaml_validator",
    "name": "YAML Validator",
    "category": "Developer Utilities",
    "description": "Validate YAML syntax and report problems.",
    "rating": 4.6,
    "installs": "21K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "yaml",
      "validator",
      "validate",
      "lint"
    ],
    "systemPromptSnippet": "Validate YAML syntax and report problems. Parameters: path (path, optional); text (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": false
      },
      {
        "name": "text",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_code_formatter",
    "name": "Code Formatter",
    "category": "Developer Utilities",
    "description": "Format source code with Prettier or the project formatter.",
    "rating": 4.5,
    "installs": "5.6K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "code",
      "formatter",
      "format",
      "prettier",
      "beautify"
    ],
    "systemPromptSnippet": "Format source code with Prettier or the project formatter. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_regex_tester",
    "name": "Regex Tester",
    "category": "Developer Utilities",
    "description": "Test a regular expression against sample input and show matches.",
    "rating": 4.9,
    "installs": "9.4K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "regex",
      "tester",
      "test",
      "match"
    ],
    "systemPromptSnippet": "Test a regular expression against sample input and show matches. Parameters: pattern (string, required); sample (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "pattern",
        "type": "string",
        "required": true
      },
      {
        "name": "sample",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_base64_tool",
    "name": "Base64 Tool",
    "category": "Developer Utilities",
    "description": "Encode or decode Base64 text.",
    "rating": 4.8,
    "installs": "15K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "base64",
      "tool",
      "encode",
      "decode"
    ],
    "systemPromptSnippet": "Encode or decode Base64 text. Parameters: text (string, required); mode (enum, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "text",
        "type": "string",
        "required": true
      },
      {
        "name": "mode",
        "type": "enum",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_uuid_generator",
    "name": "UUID Generator",
    "category": "Developer Utilities",
    "description": "Generate one or more version-4 UUIDs.",
    "rating": 4.7,
    "installs": "2.7K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "uuid",
      "generator",
      "guid"
    ],
    "systemPromptSnippet": "Generate one or more version-4 UUIDs. Parameters: count (number, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "count",
        "type": "number",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_hash_generator",
    "name": "Hash Generator",
    "category": "Developer Utilities",
    "description": "Hash a string with md5, sha1, or sha256.",
    "rating": 4.6,
    "installs": "18K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "hash",
      "generator",
      "md5",
      "sha"
    ],
    "systemPromptSnippet": "Hash a string with md5, sha1, or sha256. Parameters: text (string, required); algorithm (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "text",
        "type": "string",
        "required": true
      },
      {
        "name": "algorithm",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_jwt_decoder",
    "name": "JWT Decoder",
    "category": "Developer Utilities",
    "description": "Decode a JWT's header and payload without verifying the signature.",
    "rating": 4.5,
    "installs": "6.3K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "jwt",
      "decoder",
      "token",
      "decode"
    ],
    "systemPromptSnippet": "Decode a JWT's header and payload without verifying the signature. Parameters: token (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "token",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_cron_explainer",
    "name": "Cron Explainer",
    "category": "Developer Utilities",
    "description": "Explain a cron expression in plain language.",
    "rating": 4.9,
    "installs": "11K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "cron",
      "explainer",
      "schedule",
      "explain"
    ],
    "systemPromptSnippet": "Explain a cron expression in plain language. Parameters: expression (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "expression",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_env_template",
    "name": "Env Template",
    "category": "Developer Utilities",
    "description": "Generate a .env.example from a .env with all values redacted.",
    "rating": 4.8,
    "installs": "24K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "env",
      "template",
      "dotenv"
    ],
    "systemPromptSnippet": "Generate a .env.example from a .env with all values redacted. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_package_auditor",
    "name": "Package Auditor",
    "category": "Developer Utilities",
    "description": "Run an npm or pip audit and summarize vulnerabilities.",
    "rating": 4.7,
    "installs": "4.1K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "package",
      "auditor",
      "audit",
      "security",
      "deps"
    ],
    "systemPromptSnippet": "Run an npm or pip audit and summarize vulnerabilities. Parameters: manager (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "manager",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_outdated_deps",
    "name": "Outdated Deps",
    "category": "Developer Utilities",
    "description": "List outdated dependencies for a project.",
    "rating": 4.6,
    "installs": "7.7K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "outdated",
      "deps",
      "update"
    ],
    "systemPromptSnippet": "List outdated dependencies for a project. Parameters: manager (enum, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "manager",
        "type": "enum",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_lint_runner",
    "name": "Lint Runner",
    "category": "Developer Utilities",
    "description": "Run the project linter and summarize the issues found.",
    "rating": 4.5,
    "installs": "19K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "lint",
      "runner",
      "eslint",
      "quality"
    ],
    "systemPromptSnippet": "Run the project linter and summarize the issues found. Parameters: path (path, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_file_differ",
    "name": "File Differ",
    "category": "Developer Utilities",
    "description": "Diff two files and show what changed.",
    "rating": 4.9,
    "installs": "9.9K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "file",
      "differ",
      "diff",
      "compare",
      "files"
    ],
    "systemPromptSnippet": "Diff two files and show what changed. Parameters: left (path, required); right (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "left",
        "type": "path",
        "required": true
      },
      {
        "name": "right",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_minifier",
    "name": "Minifier",
    "category": "Developer Utilities",
    "description": "Minify JavaScript or CSS.",
    "rating": 4.8,
    "installs": "13K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "minifier",
      "minify",
      "compress",
      "uglify"
    ],
    "systemPromptSnippet": "Minify JavaScript or CSS. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_color_converter",
    "name": "Color Converter",
    "category": "Developer Utilities",
    "description": "Convert a color between hex, rgb, and hsl.",
    "rating": 4.7,
    "installs": "6.8K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "color",
      "converter",
      "hex",
      "rgb"
    ],
    "systemPromptSnippet": "Convert a color between hex, rgb, and hsl. Parameters: value (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "value",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_timestamp_converter",
    "name": "Timestamp Converter",
    "category": "Developer Utilities",
    "description": "Convert between epoch seconds and an ISO datetime.",
    "rating": 4.6,
    "installs": "16K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "timestamp",
      "converter",
      "epoch",
      "date"
    ],
    "systemPromptSnippet": "Convert between epoch seconds and an ISO datetime. Parameters: value (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "value",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_markdown_renderer",
    "name": "Markdown Renderer",
    "category": "Developer Utilities",
    "description": "Convert Markdown text or a file to HTML.",
    "rating": 4.5,
    "installs": "5.2K",
    "screenshotTone": "gold",
    "triggerKeywords": [
      "markdown",
      "renderer",
      "html",
      "render"
    ],
    "systemPromptSnippet": "Convert Markdown text or a file to HTML. Parameters: path (path, optional); text (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": false
      },
      {
        "name": "text",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_webhook_trigger",
    "name": "Webhook Trigger",
    "category": "Web APIs",
    "description": "POST a JSON payload to a configured webhook URL.",
    "rating": 4.9,
    "installs": "3.2K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "webhook",
      "trigger",
      "post"
    ],
    "systemPromptSnippet": "POST a JSON payload to a configured webhook URL. Parameters: url (url, required); payload (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      },
      {
        "name": "payload",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_weather_fetch",
    "name": "Weather Fetch",
    "category": "Web APIs",
    "description": "Get the current weather for a city or location.",
    "rating": 4.8,
    "installs": "8.1K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "weather",
      "fetch",
      "forecast",
      "temp"
    ],
    "systemPromptSnippet": "Get the current weather for a city or location. Parameters: location (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "location",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_text_to_speech",
    "name": "Text To Speech",
    "category": "Web APIs",
    "description": "Synthesize text into an audio file.",
    "rating": 4.7,
    "installs": "12K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "text",
      "speech",
      "tts",
      "voice"
    ],
    "systemPromptSnippet": "Synthesize text into an audio file. Parameters: text (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "text",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_currency_converter",
    "name": "Currency Converter",
    "category": "Web APIs",
    "description": "Convert an amount between currencies at live rates.",
    "rating": 4.6,
    "installs": "21K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "currency",
      "converter",
      "exchange"
    ],
    "systemPromptSnippet": "Convert an amount between currencies at live rates. Parameters: amount (number, required); from (string, required); to (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "amount",
        "type": "number",
        "required": true
      },
      {
        "name": "from",
        "type": "string",
        "required": true
      },
      {
        "name": "to",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_translator",
    "name": "Translator",
    "category": "Web APIs",
    "description": "Translate text from one language to another.",
    "rating": 4.5,
    "installs": "5.6K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "translator",
      "translate",
      "language",
      "i18n"
    ],
    "systemPromptSnippet": "Translate text from one language to another. Parameters: text (string, required); target (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "text",
        "type": "string",
        "required": true
      },
      {
        "name": "target",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_geocoder",
    "name": "Geocoder",
    "category": "Web APIs",
    "description": "Convert a street address into latitude and longitude.",
    "rating": 4.9,
    "installs": "9.4K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "geocoder",
      "geocode",
      "address",
      "coords"
    ],
    "systemPromptSnippet": "Convert a street address into latitude and longitude. Parameters: address (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "address",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_qr_generator",
    "name": "QR Generator",
    "category": "Web APIs",
    "description": "Generate a QR code image for text or a URL.",
    "rating": 4.8,
    "installs": "15K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "generator",
      "qrcode",
      "barcode"
    ],
    "systemPromptSnippet": "Generate a QR code image for text or a URL. Parameters: data (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "data",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_url_shortener",
    "name": "URL Shortener",
    "category": "Web APIs",
    "description": "Shorten a long URL through a link-shortening API.",
    "rating": 4.7,
    "installs": "2.7K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "url",
      "shortener",
      "shorten",
      "link"
    ],
    "systemPromptSnippet": "Shorten a long URL through a link-shortening API. Parameters: url (url, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_rss_reader",
    "name": "RSS Reader",
    "category": "Web APIs",
    "description": "Fetch and summarize an RSS or Atom feed.",
    "rating": 4.6,
    "installs": "18K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "rss",
      "reader",
      "feed",
      "news"
    ],
    "systemPromptSnippet": "Fetch and summarize an RSS or Atom feed. Parameters: url (url, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "url",
        "type": "url",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_github_repo_info",
    "name": "GitHub Repo Info",
    "category": "Web APIs",
    "description": "Fetch stars, issues, and details for a GitHub repository.",
    "rating": 4.5,
    "installs": "6.3K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "github",
      "repo",
      "info",
      "stars"
    ],
    "systemPromptSnippet": "Fetch stars, issues, and details for a GitHub repository. Parameters: repo (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "repo",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_stock_quote",
    "name": "Stock Quote",
    "category": "Web APIs",
    "description": "Fetch the latest price for a stock ticker.",
    "rating": 4.9,
    "installs": "11K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "stock",
      "quote",
      "ticker"
    ],
    "systemPromptSnippet": "Fetch the latest price for a stock ticker. Parameters: symbol (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "symbol",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_crypto_price",
    "name": "Crypto Price",
    "category": "Web APIs",
    "description": "Fetch the current price of a cryptocurrency.",
    "rating": 4.8,
    "installs": "24K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "crypto",
      "price",
      "bitcoin"
    ],
    "systemPromptSnippet": "Fetch the current price of a cryptocurrency. Parameters: symbol (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "symbol",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_news_headlines",
    "name": "News Headlines",
    "category": "Web APIs",
    "description": "Fetch the top news headlines, optionally by topic.",
    "rating": 4.7,
    "installs": "4.1K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "news",
      "headlines",
      "topic"
    ],
    "systemPromptSnippet": "Fetch the top news headlines, optionally by topic. Parameters: topic (string, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "topic",
        "type": "string",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_dictionary_lookup",
    "name": "Dictionary Lookup",
    "category": "Web APIs",
    "description": "Define a word and show example usage.",
    "rating": 4.6,
    "installs": "7.7K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "dictionary",
      "lookup",
      "define",
      "word"
    ],
    "systemPromptSnippet": "Define a word and show example usage. Parameters: word (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "word",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_ip_geolocation",
    "name": "IP Geolocation",
    "category": "Web APIs",
    "description": "Look up the approximate region for an IP address.",
    "rating": 4.5,
    "installs": "19K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "geolocation",
      "geoip",
      "location"
    ],
    "systemPromptSnippet": "Look up the approximate region for an IP address. Parameters: ip (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "ip",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_holiday_lookup",
    "name": "Holiday Lookup",
    "category": "Web APIs",
    "description": "List public holidays for a country and year.",
    "rating": 4.9,
    "installs": "9.9K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "holiday",
      "lookup",
      "holidays",
      "calendar",
      "country"
    ],
    "systemPromptSnippet": "List public holidays for a country and year. Parameters: country (string, required); year (number, optional). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "country",
        "type": "string",
        "required": true
      },
      {
        "name": "year",
        "type": "number",
        "required": false
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_time_zone_converter",
    "name": "Time Zone Converter",
    "category": "Web APIs",
    "description": "Convert a time from one time zone to another.",
    "rating": 4.8,
    "installs": "13K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "time",
      "zone",
      "converter",
      "timezone",
      "convert",
      "utc"
    ],
    "systemPromptSnippet": "Convert a time from one time zone to another. Parameters: time (string, required); from (string, required); to (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "time",
        "type": "string",
        "required": true
      },
      {
        "name": "from",
        "type": "string",
        "required": true
      },
      {
        "name": "to",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_email_validator",
    "name": "Email Validator",
    "category": "Web APIs",
    "description": "Validate an email address format and deliverability via an API.",
    "rating": 4.7,
    "installs": "6.8K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "email",
      "validator",
      "validate",
      "verify"
    ],
    "systemPromptSnippet": "Validate an email address format and deliverability via an API. Parameters: email (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "email",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_sentiment_analyzer",
    "name": "Sentiment Analyzer",
    "category": "Web APIs",
    "description": "Score the sentiment of a piece of text.",
    "rating": 4.6,
    "installs": "16K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "sentiment",
      "analyzer",
      "nlp",
      "mood"
    ],
    "systemPromptSnippet": "Score the sentiment of a piece of text. Parameters: text (string, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "text",
        "type": "string",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  },
  {
    "id": "store_image_ocr",
    "name": "Image OCR",
    "category": "Web APIs",
    "description": "Extract text from an image.",
    "rating": 4.5,
    "installs": "5.2K",
    "screenshotTone": "rose",
    "triggerKeywords": [
      "image",
      "ocr",
      "text"
    ],
    "systemPromptSnippet": "Extract text from an image. Parameters: path (path, required). Safety: Validate and type-check every parameter before use. Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands. Reject any file path containing '..' or resolving outside the approved workspace. Request explicit user confirmation before any destructive, irreversible, or system-altering action.",
    "osTargets": [
      "windows",
      "macos",
      "linux",
      "android"
    ],
    "parameters": [
      {
        "name": "path",
        "type": "path",
        "required": true
      }
    ],
    "safety": [
      "Validate and type-check every parameter before use.",
      "Never build a shell command by string concatenation; pass arguments as an array so input cannot inject extra commands.",
      "Reject any file path containing '..' or resolving outside the approved workspace.",
      "Request explicit user confirmation before any destructive, irreversible, or system-altering action."
    ]
  }
];

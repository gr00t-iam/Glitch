import { FormEvent, useMemo, useState } from "react";
import { BookMarked, Copy, Plus, Search, Trash2, Wand2, X } from "lucide-react";
import { SavedPrompt } from "../db/nexusDB";

interface PromptLibraryProps {
  prompts: SavedPrompt[];
  onClose: () => void;
  onUse: (prompt: SavedPrompt) => void;
  onSave: (input: { id?: string; title: string; body: string; tags: string[] }) => Promise<void>;
  onDelete: (promptId: string) => Promise<void>;
}

export function PromptLibrary({ prompts, onClose, onUse, onSave, onDelete }: PromptLibraryProps) {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [tags, setTags] = useState("");
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const sorted = [...prompts].sort((a, b) => b.updatedAt - a.updatedAt);
    if (!normalized) return sorted;
    return sorted.filter((prompt) =>
      [prompt.title, prompt.body, ...prompt.tags].some((value) => value.toLowerCase().includes(normalized)),
    );
  }, [prompts, query]);

  async function handleSave(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !body.trim()) return;
    setSaving(true);
    try {
      await onSave({ title, body, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean) });
      setTitle("");
      setBody("");
      setTags("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section className="modal prompt-library" role="dialog" aria-label="Prompt Library" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="modal-kicker">
            <BookMarked size={16} />
            Prompt Library
          </div>
          <button aria-label="Close prompt library" onClick={onClose}>
            <X size={16} />
          </button>
        </header>

        <div className="prompt-library-body">
          <form className="prompt-composer" onSubmit={(event) => void handleSave(event)}>
            <h3>New prompt</h3>
            <input aria-label="Prompt title" placeholder="Title (e.g. Weekly standup summary)" value={title} onChange={(event) => setTitle(event.target.value)} />
            <textarea aria-label="Prompt body" placeholder="Write a reusable prompt..." value={body} onChange={(event) => setBody(event.target.value)} rows={5} />
            <input aria-label="Prompt tags" placeholder="tags, comma, separated" value={tags} onChange={(event) => setTags(event.target.value)} />
            <button disabled={saving || !title.trim() || !body.trim()}>
              <Plus size={15} />
              {saving ? "Saving..." : "Save prompt"}
            </button>
          </form>

          <div className="prompt-list-wrap">
            <div className="prompt-list-search">
              <Search size={15} />
              <input aria-label="Search prompts" placeholder="Search saved prompts..." value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="prompt-list">
              {filtered.length === 0 ? (
                <div className="prompt-empty">
                  <Wand2 size={22} />
                  <p>No saved prompts yet. Create one on the left to reuse it anytime.</p>
                </div>
              ) : (
                filtered.map((prompt) => (
                  <article className="prompt-row" key={prompt.id}>
                    <div className="prompt-row-main">
                      <strong>{prompt.title}</strong>
                      <p>{prompt.body}</p>
                      {prompt.tags.length > 0 && (
                        <div className="prompt-tags">
                          {prompt.tags.map((tag) => (
                            <span key={tag}>#{tag}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="prompt-row-actions">
                      <button title="Use prompt" onClick={() => onUse(prompt)}>
                        <Copy size={14} />
                        Use
                      </button>
                      <button title="Delete prompt" className="danger" onClick={() => void onDelete(prompt.id)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

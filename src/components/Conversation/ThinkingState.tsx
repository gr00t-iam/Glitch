export interface ThinkingStateProps {
  isThinking: boolean;
}

/** A transient assistant message shown only before the first response token arrives. */
export function ThinkingState({ isThinking }: ThinkingStateProps) {
  if (!isThinking) return null;

  return (
    <article className="message agent thinking-state-message" aria-live="polite">
      <div className="message-role">Helper</div>
      <div className="thinking-state" role="status" aria-label="Helper is thinking">
        <span className="thinking-wave" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>Thinking...</span>
      </div>
    </article>
  );
}

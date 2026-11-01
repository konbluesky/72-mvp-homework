import { messageStatusText, type OutgoingMessage } from '../../interaction/messages.js';

export function MessageStatus({
  message,
  retrying,
  canRetry,
  onRetry,
}: {
  message?: OutgoingMessage;
  retrying: boolean;
  canRetry: boolean;
  onRetry(): void;
}) {
  const label = retrying
    ? '正在重试…'
    : canRetry
      ? '回复失败，点击重试'
      : messageStatusText(message);
  return (
    <>
      {message?.status === 'failed' && (
        <button
          className="message-retry"
          type="button"
          disabled={!canRetry || retrying}
          aria-label="重试这条消息"
          title={message.error}
          onClick={onRetry}
        >
          <span aria-hidden="true">!</span>
        </button>
      )}
      {label && (
        <small
          className={`message-status${message?.status === 'failed' ? ' message-status-failed' : ''}`}
          role="status"
          title={message?.error}
        >
          {label}
        </small>
      )}
    </>
  );
}

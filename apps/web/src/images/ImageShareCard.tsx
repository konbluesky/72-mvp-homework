import { useEffect, useRef } from 'react';
import type { ImageShareView } from '../interaction/conversation-items.js';
import { imageStatus } from '../interaction/conversation-items.js';
import type { MediaShareCoordinator } from '../interaction/media-share-coordinator.js';
import './cards.css';
export function ImageShareCard({
  share,
  coordinator,
  history = false,
}: {
  share: ImageShareView;
  coordinator: MediaShareCoordinator;
  history?: boolean;
}) {
  const node = useRef<HTMLElement>(null);
  const large = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = node.current;
    coordinator.register(share.shareId, element);
    return () => coordinator.register(share.shareId, null, element);
  }, [coordinator, share.shareId]);
  useEffect(() => {
    if (share.presentedAt && !share.url && share.display !== 'load_failed')
      void coordinator.restore(share);
  }, [coordinator, share.presentedAt, share.assetId]);
  const terminal = ['cancelled', 'expired', 'presented'].includes(share.phase);
  return (
    <article
      ref={node}
      className={`image-share-card ${share.collapsed ? 'is-collapsed' : ''}`}
      data-share-id={share.shareId}
      aria-label={share.title}
    >
      <header>
        <strong>
          {share.title}
          {share.simulated ? ' · 模拟' : ''}
        </strong>
        <button
          type="button"
          onClick={() => coordinator.collapse(share.shareId)}
          aria-expanded={!share.collapsed}
        >
          {share.collapsed ? '展开' : '收起'}
        </button>
      </header>
      {!share.collapsed && (
        <div className="image-share-preview">
          {share.url &&
          share.display === 'presented' &&
          !['cancelled', 'expired'].includes(share.phase) ? (
            <button
              type="button"
              className="image-share-enlarge"
              aria-label="放大照片"
              onClick={() => {
                coordinator.gate({ modal: true });
                large.current?.showModal();
              }}
            >
              <img
                src={share.url}
                alt={`${share.originLabel}${share.simulated ? '（模拟场景图）' : ''}`}
              />
            </button>
          ) : (
            <span aria-hidden="true">{share.phase === 'failed' ? '暂未完成' : '纪念照'}</span>
          )}
        </div>
      )}
      <p role="status" aria-live={history ? 'off' : 'polite'}>
        {imageStatus(share)}
      </p>
      <small>{share.originLabel}</small>
      <div className="image-share-actions">
        {(share.phase === 'ready' || share.display === 'load_failed') &&
          !['cancelled', 'expired'].includes(share.phase) && (
            <button
              type="button"
              disabled={share.operation}
              onClick={(event) => {
                event.currentTarget.blur();
                void coordinator.view(share.shareId);
              }}
            >
              {share.display === 'load_failed' ? '重新加载' : '查看'}
            </button>
          )}
        {share.canRetryGeneration && (
          <button
            type="button"
            disabled={share.operation}
            onClick={() => void coordinator.retry(share.shareId)}
          >
            重新准备一次
          </button>
        )}
        {!terminal && (
          <button
            type="button"
            disabled={share.operation}
            onClick={() => void coordinator.cancel(share.shareId)}
          >
            取消这张
          </button>
        )}
      </div>
      <dialog
        ref={large}
        className="image-share-lightbox"
        onClose={() => coordinator.gate({ modal: false })}
      >
        <button type="button" autoFocus onClick={() => large.current?.close()}>
          关闭大图
        </button>
        {share.url && <img src={share.url} alt={share.originLabel} />}
      </dialog>
    </article>
  );
}

import { useEffect, useRef, useState } from 'react';
import { createWorkbench, DEMO_SCENES } from './composition';
import type { VisualEngineLease } from './runtime/engine-adapter';
import type { StageEvidence, StageScene } from './runtime/visual-port';

export function App() {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [selected, setSelected] = useState<string>(DEMO_SCENES[0].id);
  const [evidence, setEvidence] = useState<StageEvidence>();
  const leaseRef = useRef<VisualEngineLease>();
  const requestRef = useRef(0);
  const sceneRef = useRef<StageScene>(DEMO_SCENES[0]);
  const scene = DEMO_SCENES.find((item) => item.id === selected) ?? DEMO_SCENES[0];

  function show(next: StageScene, id = selected) {
    const lease = leaseRef.current;
    if (!lease) return;
    const request = ++requestRef.current;
    setState('loading');
    void lease.visuals.present(next).then(
      (value) => {
        if (leaseRef.current !== lease || requestRef.current !== request) return;
        sceneRef.current = next;
        setSelected(id);
        setEvidence(value);
        setState('ready');
      },
      () => {
        if (leaseRef.current === lease && requestRef.current === request) setState('failed');
      },
    );
  }

  useEffect(() => {
    const runtime = createWorkbench();
    let active = true;
    setState('loading');
    setEvidence(undefined);
    void runtime.initialize().then(
      (lease) => {
        if (!active) return;
        leaseRef.current = lease;
        show(DEMO_SCENES[0], DEMO_SCENES[0].id);
      },
      () => {
        if (active) setState('failed');
      },
    );
    return () => {
      active = false;
      requestRef.current++;
      leaseRef.current = undefined;
      runtime.dispose();
    };
  }, [attempt]);

  const rainy = (evidence?.particles ?? 0) > 0;
  const zoomed = (evidence?.zoom ?? 1) > 1;
  const busy = state !== 'ready';

  return (
    <main
      className="webgal-workbench"
      data-stage-epoch={evidence?.stageEpoch}
      data-preview-state={state}
    >
      <nav className="workbench-nav" aria-label="工作台导航">
        <a className="workbench-brand" href="/">
          ✳ 雨停之前
        </a>
        <a href="/">
          返回现有对话 <span aria-hidden="true">↗</span>
        </a>
      </nav>
      <header className="workbench-heading">
        <div>
          <p className="eyebrow">WEBGAL ENGINE PREVIEW · 4.6.6</p>
          <h1>WebGAL 场景演示</h1>
          <p>切换时间、开关雨效、改变视角。现在可以直接看到引擎在做什么。</p>
        </div>
        <span className="phase-badge">B0 可见样板 · 完整迁移未完成</span>
      </header>
      <div className="workbench-grid">
        <section className="preview-panel" aria-label="WebGAL 场景预览">
          <div className="engine-stage">
            <div id="pixiContianer" />
            <div className="scene-label">
              <span className="live-dot" />
              {scene.label}
              <small>引擎示例场景</small>
            </div>
            {state !== 'ready' && (
              <div className="stage-status" role="status">
                {state === 'loading' ? '正在加载 WebGAL 场景…' : '场景加载失败，请重新创建舞台。'}
              </div>
            )}
          </div>
          <div className="scene-controls">
            <div className="scene-tabs" aria-label="内置示例场景">
              {DEMO_SCENES.map((item) => (
                <button
                  key={item.id}
                  disabled={busy}
                  aria-pressed={selected === item.id}
                  onClick={() => show(item, item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <p className="scene-description">{scene.description}</p>
            <div className="effect-controls">
              <button
                disabled={busy}
                aria-pressed={rainy}
                onClick={() => show({ ...sceneRef.current, effects: rainy ? [] : ['rain'] })}
              >
                {rainy ? '关闭雨效' : '开启雨效'}
              </button>
              <button
                disabled={busy}
                aria-pressed={zoomed}
                onClick={() => show({ ...sceneRef.current, zoom: zoomed ? 1 : 1.12 })}
              >
                {zoomed ? '还原视角' : '放大视角'}
              </button>
              <button className="rebuild" onClick={() => setAttempt((value) => value + 1)}>
                重新创建舞台 <span aria-hidden="true">↻</span>
              </button>
            </div>
          </div>
        </section>
        <aside className="integration-panel" aria-label="集成状态与验证">
          <div className="evidence-heading">
            <span className={state === 'ready' ? 'live-dot' : 'pending-dot'} />
            <h2>引擎运行状态</h2>
          </div>
          <p className="evidence-status" role="status">
            {state === 'ready'
              ? '场景已由 WebGAL 绘制'
              : state === 'loading'
                ? '正在准备舞台与资源'
                : '等待重新创建舞台'}
          </p>
          <dl className="engine-evidence">
            <div>
              <dt>引擎 / 模式</dt>
              <dd>WebGAL {evidence?.engineVersion ?? '4.6.6'} / interactive</dd>
            </div>
            <div>
              <dt>舞台实例</dt>
              <dd data-evidence="epoch">{evidence?.stageEpoch ?? '—'}</dd>
            </div>
            <div>
              <dt>背景对象</dt>
              <dd data-evidence="backgrounds">{evidence?.backgroundObjects ?? '—'}</dd>
            </div>
            <div>
              <dt>原生雨粒子</dt>
              <dd data-evidence="particles">{evidence?.particles ?? '—'}</dd>
            </div>
            <div>
              <dt>状态提交</dt>
              <dd data-evidence="commits">{evidence?.commits ?? '—'}</dd>
            </div>
            <div>
              <dt>视角缩放</dt>
              <dd data-evidence="zoom">{evidence ? Math.round(evidence.zoom * 100) + '%' : '—'}</dd>
            </div>
          </dl>
          <details className="engine-details">
            <summary>这些画面如何来自 WebGAL？</summary>
            <p>
              背景通过 <code>StageStateManager → syncPixiStageState → PixiStage</code>{' '}
              加载；雨滴使用 WebGAL 原生 <code>rain</code> 特效和引擎 ticker；视角使用引擎
              transform。
            </p>
            <p>
              场景图片为本项目绘制的本地
              SVG。这里是引擎能力示例，未运行上游演示剧本，也未连接后端或发出剧情回执。
            </p>
          </details>
          <div className="migration-status">
            <h2>当前集成边界</h2>
            <ul>
              <li>
                <span className="complete-mark">✓</span> 完整引擎源码、React 宿主与构建
              </li>
              <li>
                <span className="complete-mark">✓</span> 背景、原生雨效、变换与重建
              </li>
              <li>
                <span className="pending-mark">○</span> B1：输入、字幕与对话链迁移
              </li>
              <li>
                <span className="pending-mark">○</span> B2：Bridge、轮次取消与回执
              </li>
              <li>
                <span className="pending-mark">○</span> B3：Haru、口型与正式场景
              </li>
            </ul>
          </div>
        </aside>
      </div>
      <footer>
        此页用于确认 WebGAL 引擎接入。首页仍是现有 Vue / Live2D 版本；Haru 为技术替身，原创 Mira
        模型仍待交付。
      </footer>
    </main>
  );
}

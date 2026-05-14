/**
 * MindMapViewer — SVG 思维导图渲染组件
 *
 * 输入:
 *   - markdown: LLM 输出的严格大纲文本(由 parseMindMap 解析)
 *   - citations: 与 artifact 关联的引用列表(用于 [N] 跳转)
 *
 * 行为:
 *   - 解析失败(root === null):降级显示原文 + 警告横幅
 *   - 解析有警告(errors.length > 0):折叠面板列出前 10 条
 *   - 节点 click → 折叠/展开;鼠标滚轮 → 缩放;左键拖拽 → 平移
 *   - 节点尾部带引用编号时,在节点右侧渲染 CitationLink
 *
 * 布局算法:
 *   visit(node, depth) 递归返回 LaidNode;叶子节点直接占用 cursorY 并自增,
 *   父节点 y = (firstChild.y + lastChild.y) / 2,然后在父节点构造 edges
 *   (父右边界 → 子左边界)。这样保证 edge 端点指向真实子节点位置。
 *
 * 注意:
 *   - 不调 wheel preventDefault(React 合成事件 passive 化会警告);
 *     容器 overflow:hidden 已避免页面滚动竞争。
 *   - SVG <foreignObject> 用于在节点旁渲染 React 的 CitationLink。
 */
import React, { useMemo, useRef, useState } from 'react';
import type { Citation } from 'src/types/chat';
import type { MindNode } from 'src/generation/mindmap';
import { parseMindMap } from 'src/generation/mindmap';
import { CitationLink } from 'src/ui/components/CitationLink';

interface Props {
  markdown: string;
  citations: Citation[];
}

const NODE_H = 28;
const NODE_V_GAP = 8;
const LEVEL_GAP = 180;
const NODE_PAD_X = 10;
const FONT = '13px ui-sans-serif, system-ui, -apple-system, sans-serif';

interface LaidNode {
  node: MindNode;
  id: string;
  x: number;
  y: number;
  w: number;
  depth: number;
}
interface Edge {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
interface Layout {
  nodes: LaidNode[];
  edges: Edge[];
  bbox: { w: number; h: number };
}

function measureWidth(text: string, ctx: CanvasRenderingContext2D | null): number {
  if (!ctx) {
    // 无 canvas 上下文(测试 / SSR):粗略估算
    return Math.max(80, text.length * 8 + NODE_PAD_X * 2 + 28);
  }
  return Math.max(60, Math.ceil(ctx.measureText(text).width) + NODE_PAD_X * 2 + 28);
}

function layoutTree(root: MindNode, collapsed: Record<string, boolean>): Layout {
  const ctx =
    typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
  if (ctx) ctx.font = FONT;

  const nodes: LaidNode[] = [];
  const edges: Edge[] = [];
  let cursorY = 0;

  function visit(node: MindNode, depth: number): LaidNode {
    const w = measureWidth(node.text, ctx);
    const x = depth * LEVEL_GAP;
    const isCollapsed = !!collapsed[node.id];
    const visibleChildren = isCollapsed ? [] : node.children;

    let y: number;
    if (visibleChildren.length === 0) {
      y = cursorY;
      cursorY += NODE_H + NODE_V_GAP;
    } else {
      const childLaid = visibleChildren.map(c => visit(c, depth + 1));
      const firstY = childLaid[0].y;
      const lastY = childLaid[childLaid.length - 1].y;
      y = (firstY + lastY) / 2;
      // 父→子连线(此时 child 已 push,坐标已定)
      for (const cn of childLaid) {
        edges.push({
          x1: x + w,
          y1: y + NODE_H / 2,
          x2: cn.x,
          y2: cn.y + NODE_H / 2,
        });
      }
    }

    const laid: LaidNode = { node, id: node.id, x, y, w, depth };
    nodes.push(laid);
    return laid;
  }

  visit(root, 0);
  let maxX = 0;
  let maxY = 0;
  for (const n of nodes) {
    maxX = Math.max(maxX, n.x + n.w + 100);
    maxY = Math.max(maxY, n.y + NODE_H + 20);
  }
  return { nodes, edges, bbox: { w: maxX, h: maxY } };
}

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const mx = (x1 + x2) / 2;
  return `M ${x1},${y1} C ${mx},${y1} ${mx},${y2} ${x2},${y2}`;
}

export function MindMapViewer({ markdown, citations }: Props) {
  const { root, errors } = useMemo(() => parseMindMap(markdown), [markdown]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 20, y: 20 });
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const layout = useMemo(
    () => (root ? layoutTree(root, collapsed) : null),
    [root, collapsed],
  );

  if (!root) {
    return (
      <div>
        <div
          style={{
            background: 'var(--background-modifier-error)',
            padding: '6px 10px',
            borderRadius: '4px',
            marginBottom: '8px',
          }}
        >
          {/* TODO(i18n): wire up t() */}
          ⚠ The AI did not produce a strict outline format. Showing raw output.
        </div>
        <pre style={{ whiteSpace: 'pre-wrap' }}>{markdown}</pre>
      </div>
    );
  }

  const handleWheel = (e: React.WheelEvent) => {
    const delta = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    setScale(s => Math.max(0.3, Math.min(3, s * delta)));
  };
  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('[data-node]')) return;
    dragRef.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    setPan({ x: e.clientX - dragRef.current.x, y: e.clientY - dragRef.current.y });
  };
  const handleMouseUp = () => {
    dragRef.current = null;
  };

  const toggle = (id: string) =>
    setCollapsed(c => ({ ...c, [id]: !c[id] }));

  return (
    <div>
      {errors.length > 0 && (
        <details
          style={{
            marginBottom: '6px',
            fontSize: '0.85em',
            color: 'var(--text-muted)',
          }}
        >
          {/* TODO(i18n): wire up t() */}
          <summary>Parser warnings ({errors.length})</summary>
          <ul>
            {errors.slice(0, 10).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      )}
      <div
        style={{
          width: '100%',
          height: '70vh',
          overflow: 'hidden',
          cursor: dragRef.current ? 'grabbing' : 'grab',
          border: '1px solid var(--background-modifier-border)',
          borderRadius: '4px',
          background: 'var(--background-primary-alt)',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <svg width="100%" height="100%" style={{ display: 'block' }}>
          <g transform={`translate(${pan.x}, ${pan.y}) scale(${scale})`}>
            {layout!.edges.map((e, i) => (
              <path
                key={`e-${i}`}
                d={bezier(e.x1, e.y1, e.x2, e.y2)}
                stroke="var(--text-muted)"
                strokeWidth={1.2}
                fill="none"
                opacity={0.6}
              />
            ))}
            {layout!.nodes.map(n => {
              const isCollapsed = !!collapsed[n.id];
              const hasChildren = n.node.children.length > 0;
              return (
                <g key={n.id} data-node transform={`translate(${n.x}, ${n.y})`}>
                  <rect
                    x={0}
                    y={0}
                    width={n.w}
                    height={NODE_H}
                    rx={6}
                    fill={
                      n.depth === 0
                        ? 'var(--interactive-accent)'
                        : 'var(--background-secondary)'
                    }
                    stroke="var(--background-modifier-border)"
                    strokeWidth={1}
                    style={{ cursor: hasChildren ? 'pointer' : 'default' }}
                    onClick={() => hasChildren && toggle(n.id)}
                  />
                  <text
                    x={NODE_PAD_X}
                    y={NODE_H / 2 + 4}
                    fontSize={13}
                    fill={
                      n.depth === 0
                        ? 'var(--text-on-accent)'
                        : 'var(--text-normal)'
                    }
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.node.text}
                  </text>
                  {hasChildren && (
                    <text
                      x={n.w - 18}
                      y={NODE_H / 2 + 4}
                      fontSize={11}
                      fill={
                        n.depth === 0
                          ? 'var(--text-on-accent)'
                          : 'var(--text-muted)'
                      }
                      style={{ pointerEvents: 'none' }}
                    >
                      {isCollapsed ? `▶${n.node.children.length}` : '▼'}
                    </text>
                  )}
                  {n.node.citationIndices.length > 0 && (
                    <foreignObject x={n.w + 4} y={2} width={140} height={24}>
                      <div
                        style={{
                          display: 'flex',
                          gap: '2px',
                          fontSize: '11px',
                        }}
                      >
                        {n.node.citationIndices.map(idx => {
                          const c = citations.find(x => x.index === idx);
                          return c ? (
                            <CitationLink key={idx} citation={c} />
                          ) : (
                            <span key={idx}>[{idx}]</span>
                          );
                        })}
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div
        style={{
          marginTop: '4px',
          fontSize: '0.8em',
          color: 'var(--text-muted)',
        }}
      >
        {/* TODO(i18n): wire up t() */}
        Zoom: scroll · Pan: left-drag · Collapse: click a node (▼/▶) · Current:
        {scale.toFixed(2)}x · Nodes: {layout!.nodes.length}
      </div>
    </div>
  );
}

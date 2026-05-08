"use client";

import { useEffect, useRef, useState } from "react";

interface MindMapViewProps {
  markdown: string;
  height?: number;
  onNodeClick?: (label: string) => void;
}

export default function MindMapView({ markdown, height = 520, onNodeClick }: MindMapViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const mmRef = useRef<{ destroy?: () => void } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!svgRef.current || !markdown) return;

    let cancelled = false;

    async function render() {
      try {
        const [{ Transformer }, { Markmap }] = await Promise.all([
          import("markmap-lib"),
          import("markmap-view"),
        ]);

        if (cancelled || !svgRef.current) return;

        // Clean up previous instance
        if (mmRef.current?.destroy) mmRef.current.destroy();
        svgRef.current.innerHTML = "";

        const transformer = new Transformer();
        const { root } = transformer.transform(markdown);

        const mm = Markmap.create(svgRef.current, {
          autoFit: true,
          duration: 300,
          maxWidth: 320,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          color: (node: any) => {
            const colors = ["#1a56db", "#0e9f6e", "#d97706", "#dc2626", "#7c3aed", "#0891b2"];
            return colors[(node.depth ?? 0) % colors.length];
          },
        }, root);

        mmRef.current = mm;

        // Node click support
        if (onNodeClick) {
          svgRef.current.addEventListener("click", (e) => {
            const target = e.target as Element;
            const textEl = target.closest("foreignObject")?.querySelector("div");
            if (textEl?.textContent) onNodeClick(textEl.textContent.trim());
          });
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    }

    render();

    return () => {
      cancelled = true;
      if (mmRef.current?.destroy) mmRef.current.destroy();
    };
  }, [markdown, onNodeClick]);

  if (error) {
    return <div className="mindmap-error">思维导图加载失败：{error}</div>;
  }

  return (
    <div className="mindmap-container" style={{ height }}>
      <svg ref={svgRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

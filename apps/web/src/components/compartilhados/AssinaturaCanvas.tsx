/**
 * Quadro de assinatura com o dedo (celular) ou o mouse. Devolve a imagem em PNG (data URI).
 * Usado no link do consignante e na assinatura na loja.
 */
import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

export function AssinaturaCanvas({ onMudar, altura = 170 }: { onMudar: (png: string | null) => void; altura?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const tracos = useRef(0);
  const [vazio, setVazio] = useState(true);

  // ajusta a resolução do quadro à largura da tela (nítido em celular)
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ajustar = () => {
      const r = c.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.round(r.width * dpr));
      c.height = Math.max(1, Math.round(altura * dpr));
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#0f172a';
      tracos.current = 0;
      setVazio(true);
      onMudar(null);
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [altura]);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const inicio = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    desenhando.current = true;
    ultimo.current = ponto(e);
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!desenhando.current) return;
    const ctx = ref.current?.getContext('2d');
    const p = ponto(e);
    if (!ctx || !ultimo.current) return;
    ctx.beginPath();
    ctx.moveTo(ultimo.current.x, ultimo.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ultimo.current = p;
    tracos.current++;
  };
  const fim = () => {
    if (!desenhando.current) return;
    desenhando.current = false;
    ultimo.current = null;
    if (tracos.current > 8 && ref.current) {
      setVazio(false);
      onMudar(ref.current.toDataURL('image/png'));
    }
  };
  const limpar = () => {
    const c = ref.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.restore();
    tracos.current = 0;
    setVazio(true);
    onMudar(null);
  };

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed border-slate-300 bg-white">
        <canvas
          ref={ref}
          aria-label="Quadro de assinatura"
          className="block w-full touch-none rounded-xl"
          style={{ height: altura }}
          onPointerDown={inicio}
          onPointerMove={mover}
          onPointerUp={fim}
          onPointerLeave={fim}
          onPointerCancel={fim}
        />
        {vazio && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">Assine aqui com o dedo</p>}
        <div className="pointer-events-none absolute bottom-6 left-6 right-6 border-b border-slate-300" />
      </div>
      <div className="mt-1 flex justify-end">
        <button type="button" onClick={limpar} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700">
          <Eraser className="h-3.5 w-3.5" /> Limpar
        </button>
      </div>
    </div>
  );
}

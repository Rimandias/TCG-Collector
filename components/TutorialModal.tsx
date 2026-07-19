import React, { useState } from 'react';

interface TutorialModalProps {
  onClose: () => void;
}

interface TutorialStep {
  title: string;
  description: string;
  icon: React.ReactNode;
}

const icon = (path: React.ReactNode) => (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-10 h-10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const steps: TutorialStep[] = [
  {
    title: 'Bem-vindo(a) ao PokéTracker!',
    description: 'Vamos te mostrar rapidamente como registrar sua coleção, organizar pastas de troca e negociar cartas com amigos. Leva menos de um minuto.',
    icon: icon(<><path d="M12 2 2 7l10 5 10-5-10-5Z" /><path d="m2 17 10 5 10-5" /><path d="m2 12 10 5 10-5" /></>),
  },
  {
    title: 'Registre suas cartas na aba Home',
    description: 'Navegue pelas eras e coleções do TCG Pokémon. Toque numa carta para marcar quantas cópias você tem, escolher a variação (Standard, Foil, Reverse Foil...), a qualidade (NM, SP, MP...) e informar o preço que pagou em cada uma.',
    icon: icon(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></>),
  },
  {
    title: 'Acompanhe seu progresso na aba Coleção',
    description: 'Veja quantas cartas únicas você já tem de cada coleção, o total de cartas (incluindo repetidas) e o valor total estimado, calculado a partir dos preços que você mesmo informou.',
    icon: icon(<><path d="M3 3v18h18" /><path d="M18.7 8 14 12.7l-3-3L7 13.7" /></>),
  },
  {
    title: 'Crie pastas de troca',
    description: 'Na aba Trocas, marque cartas como "para troca" e organize-as em pastas. Cada pasta pode ficar visível ou não para os seus amigos — só quem você deixar ver consegue navegar por ela.',
    icon: icon(<><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></>),
  },
  {
    title: 'Negocie com seus amigos',
    description: 'Adicione amigos pelo código único (na aba Opções) e peça cartas das pastas visíveis deles. Quem recebe o pedido escolhe entre receber em dinheiro ou oferecer cartas próprias em troca. As cartas só trocam de dono depois que os dois confirmam.',
    icon: icon(<><path d="m16 3 4 4-4 4" /><path d="M20 7H4" /><path d="m8 21-4-4 4-4" /><path d="M4 17h16" /></>),
  },
  {
    title: 'Reveja quando quiser',
    description: 'Toda troca concluída fica registrada no Histórico, dentro de Pasta de Amigos, mostrando quais cartas foram entregues e recebidas. E você pode assistir a este tutorial de novo a qualquer momento, na aba Opções.',
    icon: icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 3" /></>),
  },
];

const TutorialModal: React.FC<TutorialModalProps> = ({ onClose }) => {
  const [step, setStep] = useState(0);
  const isFirst = step === 0;
  const isLast = step === steps.length - 1;
  const current = steps[step];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white border border-slate-100 w-full max-w-sm rounded-3xl shadow-2xl p-6 flex flex-col items-center text-center">
        <button
          onClick={onClose}
          className="self-end -mt-2 -mr-2 mb-2 text-[10px] text-slate-400 hover:text-slate-600 uppercase tracking-widest"
        >
          Pular
        </button>

        <div className="w-16 h-16 rounded-2xl bg-[#646B99]/10 flex items-center justify-center text-[#646B99] mb-5">
          {current.icon}
        </div>

        <h3 className="text-base font-bold text-slate-800 mb-2">{current.title}</h3>
        <p className="text-xs text-slate-500 leading-relaxed mb-6">{current.description}</p>

        <div className="flex items-center gap-1.5 mb-6">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-[#646B99]' : 'w-1.5 bg-slate-200'}`}
            />
          ))}
        </div>

        <div className="flex gap-3 w-full">
          {!isFirst && (
            <button
              onClick={() => setStep((s) => s - 1)}
              className="flex-1 py-2.5 bg-slate-50 text-slate-500 text-xs font-semibold rounded-xl hover:bg-slate-100 transition-colors"
            >
              Voltar
            </button>
          )}
          <button
            onClick={() => (isLast ? onClose() : setStep((s) => s + 1))}
            className="flex-1 py-2.5 bg-[#646B99] text-white text-xs font-semibold rounded-xl hover:bg-[#4d5275] transition-colors"
          >
            {isLast ? 'Começar a usar' : 'Próximo'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default TutorialModal;

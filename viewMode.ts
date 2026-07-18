import { CardViewMode } from './components/CardItem';

const STORAGE_KEY = 'poketracker_card_view_mode';
const DESKTOP_BREAKPOINT = 768;

const isValidMode = (value: unknown): value is CardViewMode =>
  value === 'grid3' || value === 'grid6' || value === 'list';

export const getInitialCardViewMode = (): CardViewMode => {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isValidMode(saved)) return saved;
  } catch (e) {
    // localStorage indisponível, segue com o padrão
  }
  const isDesktop = typeof window !== 'undefined' && window.innerWidth >= DESKTOP_BREAKPOINT;
  return isDesktop ? 'grid6' : 'grid3';
};

export const saveCardViewMode = (mode: CardViewMode) => {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch (e) {
    // ignora falha ao persistir preferência
  }
};

// Classes do container do grid para cada modo. No mobile, o modo "grid6"
// cai automaticamente para 3 colunas via breakpoint responsivo do Tailwind.
export const getCardGridClassName = (mode: CardViewMode): string => {
  switch (mode) {
    case 'grid6':
      return 'grid grid-cols-3 md:grid-cols-6 gap-3';
    case 'list':
      return 'flex flex-col gap-2';
    case 'grid3':
    default:
      return 'grid grid-cols-3 gap-3';
  }
};

import React from 'react';

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}

const Pagination: React.FC<PaginationProps> = ({ page, totalPages, onPageChange }) => {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-center gap-3 py-2">
      <button
        onClick={() => onPageChange(Math.max(1, page - 1))}
        disabled={page <= 1}
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 border border-slate-100 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Anterior
      </button>
      <span className="text-[10px] text-slate-400 uppercase tracking-widest">
        Página {page} de {totalPages}
      </span>
      <button
        onClick={() => onPageChange(Math.min(totalPages, page + 1))}
        disabled={page >= totalPages}
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500 bg-slate-50 border border-slate-100 rounded-lg hover:bg-slate-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
      >
        Próxima
      </button>
    </div>
  );
};

export const PAGE_SIZE = 20;

export default Pagination;

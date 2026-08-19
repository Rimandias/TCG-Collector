import React, { useEffect, useState } from 'react';

interface CardImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
  // 'card-back' (padrão) - a maioria dos usos desse componente é arte de carta, então o
  // padrão mostra o verso genérico do app em vez de uma caixa vazia quando a imagem falta.
  // 'empty' - usado nos poucos lugares onde isso é logo/símbolo de set (não faz sentido
  // mostrar um verso de carta ali) - mesma caixa vazia de antes.
  fallback?: 'card-back' | 'empty';
}

// Algumas cartas (promos, Galeria de Treinador, McDonald's...) não têm imagem alguma na
// TCGdex, nem no locale pt nem no en - `card.imageUrl` vem vazio nesse caso. Um <img
// src=""> faz o navegador tentar buscar a própria URL da página como se fosse a imagem,
// gerando um 404 no console; em vez disso, renderiza o fallback (mesma className). Além
// disso, mesmo com uma URL válida, o CDN da TCGdex às vezes responde 503 (falha transitória,
// fora do nosso controle) - onError troca pro fallback em vez de deixar o ícone de imagem
// quebrada do navegador, e reseta se a src mudar (troca de carta/coleção).
const CardImage: React.FC<CardImageProps> = ({ src, alt, className, fallback = 'card-back', ...rest }) => {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (!src || failed) {
    if (fallback === 'empty') {
      return <div className={className} role="img" aria-label={alt} />;
    }
    return <img src="/card-back.svg" alt={alt || 'Verso da carta'} className={className} />;
  }
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} {...rest} />;
};

export default CardImage;

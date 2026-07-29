import React from 'react';

interface CardImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string;
}

// Algumas cartas (promos, Galeria de Treinador, McDonald's...) não têm imagem alguma na
// TCGdex, nem no locale pt nem no en - `card.imageUrl` vem vazio nesse caso. Um <img
// src=""> faz o navegador tentar buscar a própria URL da página como se fosse a imagem,
// gerando um 404 no console; em vez disso, renderiza só a caixa vazia (mesma className).
const CardImage: React.FC<CardImageProps> = ({ src, alt, className, ...rest }) => {
  if (!src) {
    return <div className={className} role="img" aria-label={alt} />;
  }
  return <img src={src} alt={alt} className={className} {...rest} />;
};

export default CardImage;

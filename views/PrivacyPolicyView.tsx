import React from 'react';

// Página pública (sem login) de Política de Privacidade - precisa ter uma URL de verdade
// acessível sem sessão porque é exigida pelo formulário de listagem do Google Play (e também
// serve como referência de "Segurança de dados" quando o Play Console pedir pra detalhar o
// que o app coleta). Conteúdo reflete só o que o app realmente coleta/faz - ver App.tsx (rota
// /privacidade) e types.ts (User/UserCardData) para o que existe de verdade.
const PrivacyPolicyView: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-2xl mx-auto animate-in fade-in duration-500 px-6 pb-16 pt-8">
        <a href="/" className="text-xs font-semibold text-[#646B99]">&larr; Voltar para o TCG Colecionador</a>

        <h2 className="text-2xl text-slate-800 mt-4">Política de Privacidade</h2>
        <p className="text-slate-400 text-xs">Última atualização: 14 de setembro de 2026.</p>

        <div className="mt-6 space-y-6 text-sm text-slate-600 leading-relaxed">
          <section>
            <p>
              O TCG Colecionador é um app para organizar sua coleção de cartas Pokémon, acompanhar
              condição/preço, montar decks e trocar cartas com amigos. Esta página explica quais
              dados o app coleta, para que usa e como você pode excluí-los.
            </p>
          </section>

          <section>
            <h3 className="text-slate-800 font-semibold mb-1">Quais dados coletamos</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li><span className="font-medium text-slate-700">Conta:</span> e-mail e senha (autenticação), nome de usuário e foto de avatar (opcional).</li>
              <li><span className="font-medium text-slate-700">Dados de uso do app:</span> as cartas que você marca como possuídas (com variação, condição e preço), sua lista de desejos, os decks que você monta e suas pastas de troca.</li>
              <li><span className="font-medium text-slate-700">Amigos:</span> seu código de amigo e a lista de contas que você adicionou como amigo (usados para liberar a visualização de pastas de troca entre vocês).</li>
            </ul>
            <p className="mt-2">
              Não coletamos localização, contatos do aparelho, nem qualquer dado de pagamento - o
              app não processa pagamentos, as trocas são combinadas diretamente entre os usuários.
            </p>
          </section>

          <section>
            <h3 className="text-slate-800 font-semibold mb-1">Para que usamos</h3>
            <p>
              Só para o funcionamento do app em si: manter sua coleção salva e sincronizada entre
              seus aparelhos, mostrar quais cartas você tem/precisa, e permitir trocas com amigos.
              Não usamos seus dados para publicidade, não vendemos dados a terceiros e não exibimos
              anúncios no app.
            </p>
          </section>

          <section>
            <h3 className="text-slate-800 font-semibold mb-1">Com quem compartilhamos</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <span className="font-medium text-slate-700">Amigos dentro do app:</span> cartas
                marcadas como repetidas (ou colocadas manualmente numa pasta) ficam visíveis para
                quem você adicionou como amigo. Um link público de pasta (quando você opta por
                gerá-lo) fica acessível a qualquer pessoa que tiver o link.
              </li>
              <li>
                <span className="font-medium text-slate-700">Infraestrutura:</span> usamos Supabase
                (banco de dados e autenticação), Render (backend/API) e Vercel (hospedagem do
                site/app) como provedores técnicos - eles armazenam/processam os dados em nosso
                nome, sob contrato, e não os usam para fins próprios.
              </li>
              <li>
                <span className="font-medium text-slate-700">Catálogo de cartas:</span> nomes,
                números e imagens das cartas Pokémon vêm da TCGdex (api.tcgdex.net), um catálogo
                público - nenhum dado seu é enviado para lá.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-slate-800 font-semibold mb-1">Segurança</h3>
            <p>
              Toda comunicação com o app é feita por HTTPS. Sua senha nunca é armazenada em texto
              puro - a autenticação é feita pelo Supabase Auth, que usa hash de senha.
            </p>
          </section>

          <section>
            <h3 className="text-slate-800 font-semibold mb-1">Exclusão dos seus dados</h3>
            <p>
              Você pode excluir sua conta e todos os dados associados a qualquer momento, dentro do
              próprio app, em <span className="font-medium text-slate-700">Opções &rarr; Excluir
              minha conta permanentemente</span>. A exclusão remove seu perfil, coleção, decks,
              pastas de troca e vínculos de amizade.
            </p>
          </section>

          <section>
            <h3 className="text-slate-800 font-semibold mb-1">Contato</h3>
            <p>
              Dúvidas sobre privacidade ou sobre esta política:{' '}
              <a href="mailto:contato@tcgcolecionador.com.br" className="text-[#646B99] font-medium">
                contato@tcgcolecionador.com.br
              </a>.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyView;

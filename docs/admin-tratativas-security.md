# Hierarquia de acesso e exclusao de tratativas

A migration `20260622205903_admin_roles_delete_tratativa.sql` prepara estas regras sem aplica-las automaticamente em producao:

- `lucas.abnersd@gmail.com` recebe `app_metadata.app_role = admin`;
- todas as demais contas existentes e futuras recebem `app_metadata.app_role = standard`;
- a conta tecnica `lucas.araujo@sdflorestal.com.br` continua `standard`, mas recebe apenas `app_metadata.can_sync_boleto = true` para preservar a importacao diaria sem acesso administrativo no painel;
- a regra e reforcada por trigger em `auth.users` e nao usa `user_metadata`, que pode ser alterado pelo usuario;
- novas policies permitem `INSERT`/`DELETE` em `boleto_pendentes_items` somente para essa conta tecnica com `can_sync_boleto = true`, preservando o fluxo atual de sincronizacao;
- `DELETE` direto em `boleto_pendentes_audit` e revogado para `anon` e `authenticated`;
- `UPDATE` direto em `boleto_pendentes_audit` e `UPDATE` anônimo em `boleto_pendentes_items` revogados, mantendo o `UPDATE` autenticado necessário ao painel/importador sob proteção de trigger;
- triggers no banco bloqueiam alteracoes de campos financeiros por usuarios padrao e sobrescrevem `last_changed_by` e os campos `changed_by_*` da auditoria com a identidade real da sessao autenticada, evitando atribuicao falsa enviada pelo navegador;
- a RPC `delete_boleto_pendentes_tratativa(p_audit_id text)` aceita somente uma tratativa ativa e exige simultaneamente o e-mail administrativo e o papel `admin` no JWT e no registro `auth.users`;
- a tratativa sai do historico ativo, mas seu conteudo e a identidade confiavel do administrador ficam preservados em uma entrada `tratativa_exclusao`.

## Impacto operacional

A alteracao de `raw_app_meta_data` so aparece em um JWT novo. Depois da aplicacao, todos os usuarios devem sair e entrar novamente. Ate a renovacao da sessao, a RPC administrativa recusara a exclusao.

Por requisito, qualquer conta diferente de `lucas.abnersd@gmail.com` passa a ser `standard`. Para nao quebrar a rotina existente, a conta tecnica conhecida do importador recebe uma permissao separada e limitada de sincronizacao, sem papel `admin` e sem capacidade de excluir tratativas.

A migration nao remove o acesso de leitura nem a inclusao de tratativas existentes. Ela tambem nao foi aplicada ao projeto Supabase durante esta alteracao.

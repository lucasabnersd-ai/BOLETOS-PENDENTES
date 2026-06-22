# Painel de Boletos Pendentes

Painel online para acompanhar a base `BOLETOS PENDENTES A ASSOCIAR.xlsx` com a identidade visual do Grupo S&D.

## O que o painel faz

- Le a tabela `Boletos Pendentes` da planilha compartilhada.
- Cria uma chave unica por boleto usando codigo de barras, linha digitavel, fonte, fornecedor, documento, valor e vencimento.
- Alimenta a tabela `boleto_pendentes_items` no Supabase.
- Publica um snapshot em `data/initial.json` e metadados em `update-meta.json`.
- Mostra abas de visao geral, boletos e modelos.
- Permite editar o status tratado/pendente e registrar tratativas com historico; os demais campos ficam em modo de leitura.
- Exige login e registra automaticamente o usuario responsavel por cada alteracao.
- Unifica fontes `CENTRAL_*` como `CENTRAL DE NOTAS` e oferece filtros rapidos para todos, DDA e Central de Notas.
- Atualiza automaticamente a tela por Realtime e tambem por polling a cada 60 segundos.

## Atualizacao diaria

Use dois cliques no arquivo:

```cmd
ATUALIZAR_BOLETOS_PENDENTES.cmd
```

Ele executa:

1. Le a planilha compartilhada.
2. Envia as linhas novas/alteradas para o Supabase.
3. Remove da base online boletos que nao estao mais na planilha.
4. Atualiza `data/initial.json` e `update-meta.json`.
5. Faz commit e push no GitHub.

## Publicacao

Repositorio: `lucasabnersd-ai/boletospendentes`

URL esperada no GitHub Pages:

```text
https://lucasabnersd-ai.github.io/boletospendentes/
```

Se o Pages ainda nao estiver ativo, habilite em `Settings > Pages` usando branch `main` e pasta `/root`.

## Configuracao Supabase

O frontend usa somente a publishable key do Supabase e exige uma sessao autenticada. As politicas RLS bloqueiam leitura e escrita anonimas.

- `standard`: consulta, atualiza o status e registra tratativas.
- `admin`: possui o acesso operacional e tambem pode executar a importacao completa.

O atualizador diario autentica o administrador usando a credencial `boletospendentes-supabase`, armazenada no Gerenciador de Credenciais do Windows. Nenhuma senha fica salva no repositorio.

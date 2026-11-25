# NEXT LEVEL — site com dados automáticos

## O que cada arquivo faz

| Arquivo | Função |
|---|---|
| `index.html` + `nextlevel3d.js` + `next_level_cyber_dimension.glb` | Abertura 3D do portal |
| `jogos.html` | Página com lançamentos, testes (beta), pré-registro, guias e notícias |
| `data/manual.json` | **Você edita**: links de beta, pré-registro e guias |
| `data/releases.json`, `data/news.json` | Gerados sozinhos pelo atualizador (não edite) |
| `config/feeds.json` | Feeds RSS das notícias (você pode trocar) |
| `scripts/update-data.mjs` | Busca RAWG, Steam, IGDB e os feeds |
| `.github/workflows/atualizar.yml` | Roda o atualizador a cada 6 horas, de graça |

Como funciona: o GitHub roda o atualizador no horário, grava os arquivos em `data/`, e o site só lê esses arquivos.
As chaves das APIs ficam guardadas no GitHub e **nunca aparecem no site**.

## Testar no seu computador

Na pasta do projeto: `python -m http.server 8000` e abra `http://localhost:8000`.
Sem a primeira atualização, "Lançamentos" e "Notícias" aparecem vazios. Isso é normal.

## Colocar no ar, passo a passo

### 1. Conseguir as chaves (todas gratuitas)
- **RAWG:** crie conta em rawg.io/apidocs e copie a chave da API.
- **IGDB (opcional):** em dev.twitch.tv, crie uma conta, ative a verificação em duas etapas e registre um aplicativo. Copie o **Client ID** e gere o **Client Secret**.
- **Steam:** não precisa de chave.
- Pode começar só com a RAWG e acrescentar o resto depois.

### 2. Criar o repositório no GitHub
1. Crie uma conta em github.com e um repositório novo (público, para usar o Pages de graça).
2. Envie para ele **todos** os arquivos desta pasta, incluindo a pasta oculta `.github` (clique em "Add file > Upload files" e arraste; confira que `.github/workflows/atualizar.yml` apareceu).

### 3. Guardar as chaves
No repositório: **Settings > Secrets and variables > Actions > New repository secret**. Crie:
- `RAWG_API_KEY`
- `TWITCH_CLIENT_ID` e `TWITCH_CLIENT_SECRET` (se for usar IGDB)

### 4. Rodar a primeira atualização
Aba **Actions > Atualizar dados dos jogos > Run workflow**. Abra a execução e leia o log: ele diz quantos itens cada fonte trouxe e avisa o que falhou.
Depois disso o agendamento segue sozinho a cada 6 horas.

### 5. Publicar o site
**Settings > Pages > Source: Deploy from a branch > Branch: main, pasta /(root) > Save.**
O endereço aparece ali (algo como `https://seu-usuario.github.io/nome-do-repositorio/`). Como é `https`, o site abre sem servidor local.

## Adicionar testes, pré-registros e guias

Edite `data/manual.json`. Exemplo (troque pelos seus dados reais):

```json
{
  "beta": [
    { "name": "Nome do jogo", "url": "https://link-do-teste", "platform": "PC", "date": "até 30/11", "note": "Como participar" }
  ],
  "prereg": [
    { "name": "Nome do jogo", "url": "https://link-do-pre-registro", "platform": "Android" }
  ],
  "guides": [
    { "title": "Título do guia", "url": "https://link-do-guia", "game": "Nome do jogo" }
  ]
}
```

Cuidado com as vírgulas: entre itens sim, depois do último não. Se der erro, cole o texto em jsonlint.com.

## Limitações (leia)

- **Beta e pré-registro não são automáticos.** Não existe uma API pública confiável para isso; por isso ficam na sua lista.
- **O endpoint da Steam não é oficial.** É o que a própria loja usa; pode mudar sem aviso. Se parar, o atualizador só avisa no log e segue com as outras fontes.
- **Os feeds de notícias em `config/feeds.json` não foram verificados.** Confira no log da primeira execução quais funcionaram e troque os que falharem.
- **Nada foi testado contra as APIs reais**, só com respostas simuladas. A primeira execução pode mostrar ajustes necessários.
- **Respeite os termos de uso:** a RAWG exige citar a fonte com link para o rawg.io no site em uso público; confira as regras de cada API antes de lançar.
- Se todas as fontes falharem, os arquivos antigos são mantidos (o site não esvazia).

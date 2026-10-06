# Folhear

Um simulador de livro físico. Qualquer arquivo que você abrir (PDF, slides, e-book, documento, pasta de imagens) é encadernado num livro de capa dura, com guardas, miolo e lombada, e as folhas se curvam de verdade quando você as vira. Funciona no navegador, no celular e no Windows, com sincronização entre computadores pelo Google Drive.

Os arquivos são abertos no próprio aparelho: nada é enviado para servidores.

## Usar no navegador (site)

Abra **https://joaogabrielmontinirossi-sys.github.io/folhear/** e clique em **Adicionar livro**, ou solte um arquivo na janela. A estante já vem com um guia, *Como folhear*, para experimentar.

## No celular

Abra o mesmo endereço no navegador do celular.

- **Android (Chrome)**: toque em **Instalar o aplicativo** no topo da estante (ou em ⋮ › *Instalar app*). O Folhear ganha ícone na tela inicial e abre em tela cheia.
- **iPhone/iPad (Safari)**: toque em **Compartilhar** › **Adicionar à Tela de Início**.

Depois de aberto uma vez, funciona sem internet. Com o aparelho em pé, o livro mostra uma página por vez; deitado, abre em duas páginas.

## No Windows (.exe)

Pegue o `Folhear.exe` na página de [Releases](../../releases/latest) e abra. Não precisa instalar nada: o programa usa o Edge (ou o Chrome) que já está no Windows para mostrar a janela.

Como o arquivo não é assinado, o Windows pode mostrar o aviso do SmartScreen na primeira vez: clique em **Mais informações** e depois em **Executar assim mesmo**.

## O livro

- **A folha se curva.** A página é uma malha 3D que enrola num cilindro seguindo a sua mão, presa à lombada como numa costura. Tem luz, sombra projetada na página de baixo e o verso da folha impresso.
- **Capa dura.** O livro começa fechado. A capa de tecido traz o título em dourado e, nos PDFs, slides e álbuns, a primeira página estampada. A capa abre rígida, como uma tampa.
- **Miolo.** O corte das folhas aparece na borda de fora e muda de espessura de cada lado conforme você avança.
- **Som de papel** a cada folha (dá para desligar).

| Para | Faça |
| --- | --- |
| Virar uma folha | Arraste a página, toque perto da borda da tela, use as setas, a barra de espaço ou a roda do mouse |
| Espiar o canto | Deixe o mouse parado sobre um canto da página |
| Ir longe | Arraste a régua embaixo, ou abra o sumário |
| Aproximar | Dois toques no meio da página, pinça, ou `Ctrl` + roda do mouse |
| Marcar a página | Botão de marcador (ou tecla `M`) |
| Fechar o livro na capa / ir ao fim | `Home` / `End` |
| Tela cheia | Tecla `F` |

## Formatos

| Formato | Como aparece |
| --- | --- |
| **PDF** | Cada página do arquivo é uma página do livro, idêntica à original |
| **PowerPoint (.pptx)** | Livro deitado, no formato dos slides. Fundo, textos, formas, imagens e tabelas são redesenhados com os estilos do layout e do slide mestre |
| **EPUB, FB2** | O texto é recomposto com a tipografia de um livro impresso: linhas justificadas, recuo de parágrafo, abertura de capítulo, cabeçalho corrente e número de página |
| **Word (.docx), ODT, RTF, TXT, Markdown, HTML** | A mesma composição dos e-books |
| **CBZ e imagens** (JPG, PNG, GIF, WebP, BMP, AVIF) | Uma imagem por página; várias imagens escolhidas de uma vez viram um álbum |

Limites conhecidos:

- Nos slides, gráficos, SmartArt, animações e efeitos (sombras, 3D) não são reproduzidos; gráficos aparecem como um quadro pontilhado. Para a aparência exata, exporte a apresentação em PDF.
- Nos e-books e documentos, o Folhear usa a própria tipografia e ignora o CSS do arquivo; tabelas viram linhas de texto.
- Não abre `.doc`/`.ppt` antigos, `.mobi`/`.azw` do Kindle, `.djvu`, `.cbr`, nem arquivos com DRM ou PDFs com senha.

## Sincronização

Funciona como no [Prisma](https://github.com/joaogabrielmontinirossi-sys/prisma), no [Ishikawa](https://github.com/joaogabrielmontinirossi-sys/ishikawa) e no [Capynote](https://github.com/joaogabrielmontinirossi-sys/capynote): o Folhear para Windows grava numa pasta do Google Drive para computador (`Meu Drive\Folhear`) e o Drive leva aos outros aparelhos.

- `folhear-sync.json` guarda a estante: títulos, capas, a página em que você parou e os marcadores. É regravado a cada alteração.
- A subpasta `livros` guarda os arquivos, um por livro. Outro computador baixa o arquivo só quando o livro é aberto.
- Se o Google Drive para computador estiver instalado, a sincronização já começa ligada. Em **Ajustes** dá para desativar, trocar de conta (cada unidade G:, H:… é uma conta) ou escolher qualquer outra pasta sincronizada (OneDrive, Dropbox…).
- Alterações feitas em dois aparelhos são mescladas por livro: vale a versão mais recente de cada um, e as exclusões também são propagadas.

No navegador e no celular os livros ficam guardados no próprio aparelho. **Ajustes › Exportar backup** gera um arquivo com a estante, as páginas e os marcadores (sem os arquivos dos livros). Cada livro é identificado pelo conteúdo do arquivo, então, ao abrir o mesmo arquivo no outro aparelho, a leitura continua de onde parou.

A cada alteração na pasta `app/` da branch `main`, o GitHub Actions publica a versão web automaticamente (`.github/workflows/web.yml`).

## Compilar

Só precisa do Windows (usa o compilador C# do .NET Framework e o Edge, que já vêm instalados):

```powershell
powershell -ExecutionPolicy Bypass -File .\build.ps1
```

Gera `dist\Folhear.exe`, com o aplicativo inteiro embutido.

| Pasta | Conteúdo |
| --- | --- |
| `app/` | O aplicativo (HTML, CSS e JavaScript puros) |
| `app/book3d.js` | O livro em WebGL: capas, miolo, a dobra da folha, luz e sombra, gestos |
| `app/flow.js` | Composição de texto em páginas (quebra de linha, justificação, capítulos) |
| `app/formats.js` | Leitura de PDF, EPUB, DOCX, ODT, FB2, CBZ, texto, Markdown, RTF e HTML |
| `app/pptx.js` | Desenho dos slides do PowerPoint |
| `app/zip.js` | Leitura de arquivos .zip com o descompactador do navegador |
| `app/lib/` | [PDF.js](https://mozilla.github.io/pdf.js/) 3.11 (Apache 2.0), a única biblioteca externa |
| `app/fonts/` | [Literata](https://github.com/googlefonts/literata) (SIL Open Font License), a letra do miolo |
| `desktop/Folhear.cs` | Programa de Windows: serve o app em `localhost` e grava a pasta de sincronização |
| `build.ps1` | Gera os ícones e compila o `.exe` |

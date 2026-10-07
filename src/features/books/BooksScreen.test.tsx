import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Route } from "@/app/routes";
import { i18n } from "@/lib/i18n/i18n";
import { clearMockBooks, setMockBookPick } from "@/lib/ipcMockBooks";
import { seedMockReadiness } from "@/lib/ipcMockChapters";
import { setMockWordKnown } from "@/lib/ipcMockWords";
import { useMockBackend } from "@/test/mockBackend";
import { BooksScreen } from "./BooksScreen";

/** The screen with the one piece of the app it needs: the current route. */
function Section({ from }: { from: Route }): ReactNode {
  const [route, setRoute] = useState<Route>(from);
  if (route.name !== "books") {
    return <p>{`Left for ${route.name}`}</p>;
  }
  return (
    <BooksScreen
      nativeLang="es"
      bookId={route.bookId}
      chapterId={route.chapterId ?? null}
      shelf={route.shelf === true}
      known={route.known === true}
      navigate={setRoute}
    />
  );
}

/** The section opened on its shelf. */
function Shelf(): ReactNode {
  return <Section from={{ name: "books", bookId: null, shelf: true }} />;
}

describe("BooksScreen", () => {
  useMockBackend();

  test("opens on the section's own screen, and the shelf leads back to it", async () => {
    const user = userEvent.setup();
    render(<Section from={{ name: "books", bookId: null }} />);

    await user.click(await screen.findByRole("button", { name: "Change" }));
    expect(
      await screen.findByRole("heading", { name: "Books" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Book" }));
    expect(
      await screen.findByRole("region", { name: "Current chapter" }),
    ).toBeInTheDocument();
  });

  test("an empty shelf says so, and that chapter text goes to Claude", async () => {
    clearMockBooks();
    render(<Shelf />);

    expect(
      await screen.findByText(
        "No books yet. Add an EPUB or a PDF to see its chapters.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "When you prepare a chapter, its text is sent to Claude.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add book" })).toBeEnabled();
  });

  test("a book opens to its chapters in order, numbered from the first", async () => {
    const user = userEvent.setup();
    render(<Shelf />);

    await user.click(
      await screen.findByRole("button", {
        name: /Alice's Adventures in Wonderland/u,
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Alice's Adventures in Wonderland" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Lewis Carroll")).toBeInTheDocument();

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "1I. Down the Rabbit-Hole0% ready2184 words",
      "2II. The Pool of Tears2098 words",
      "3III. A Caucus-Race and a Long Tale1701 words",
      "4IV. The Rabbit Sends in a Little Bill2614 words",
      "5V. Advice from a Caterpillar2183 words",
    ]);

    await user.click(screen.getByRole("button", { name: "All books" }));
    expect(screen.getByRole("heading", { name: "Books" })).toBeInTheDocument();
  });

  test("chapter rows show the share that is ready, and the book how many are", async () => {
    seedMockReadiness();
    const user = userEvent.setup();
    render(<Shelf />);

    const book = await screen.findByRole("button", {
      name: /Alice's Adventures in Wonderland/u,
    });
    expect(book).toHaveTextContent(
      "Lewis Carroll · 5 chapters · 1 ready to read",
    );
    await user.click(book);

    const rows = screen.getAllByRole("listitem");
    expect(rows.map((row) => row.textContent).slice(0, 4)).toEqual([
      "1I. Down the Rabbit-Hole12% ready2184 words",
      "2II. The Pool of TearsReady to read2098 words",
      "3III. A Caucus-Race and a Long Tale75% ready1701 words",
      // Not prepared: nothing is said about how ready it is.
      "4IV. The Rabbit Sends in a Little Bill2614 words",
    ]);

    await i18n.changeLanguage("es");
    expect(screen.getAllByRole("listitem")[1]).toHaveTextContent(
      "Listo para leer",
    );
    expect(screen.getAllByRole("listitem")[2]).toHaveTextContent("75 % listo");
  });

  test("a shelf with nothing ready says nothing about it", async () => {
    render(<Shelf />);
    const book = await screen.findByRole("button", {
      name: /Alice's Adventures in Wonderland/u,
    });
    expect(book).toHaveTextContent(/5 chapters$/u);
    // No word is known either: nothing leads to an empty list.
    expect(screen.queryByRole("button", { name: /already know/u })).toBeNull();
  });

  test("the shelf leads to every known word, and one can be taken back", async () => {
    seedMockReadiness();
    setMockWordKnown("marmalade", true);
    // Known from a book that is gone: nothing is left to translate it.
    setMockWordKnown("quay", true);
    const user = userEvent.setup();
    render(<Shelf />);

    await user.click(
      await screen.findByRole("button", { name: "3 words you already know" }),
    );
    expect(
      screen.getByRole("heading", { name: "Words you already know" }),
    ).toBeInTheDocument();
    const rows = (): Array<string | null> =>
      screen.getAllByRole("listitem").map((row) => row.textContent);
    await screen.findByText("3 words you already know");
    // The one marked last comes first.
    expect(rows()).toEqual([
      "quayUndo",
      "marmalademermeladaUndo",
      "hedgesetoUndo",
    ]);

    await user.click(screen.getByRole("button", { name: "Undo: quay" }));
    await screen.findByText("2 words you already know");
    await i18n.changeLanguage("es");
    expect(
      screen.getByRole("heading", { name: "Palabras que ya sabes" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Deshacer: marmalade" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Deshacer: hedge" }),
    );
    expect(
      await screen.findByText(
        "Aún no has marcado ninguna palabra como sabida.",
      ),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Libro" }));
    expect(
      await screen.findByRole("heading", { name: "Libro" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/ya sabes/u)).toBeNull();
  });

  test("adding a book opens it; the same file again is the same book", async () => {
    const user = userEvent.setup();
    render(<Shelf />);

    await user.click(await screen.findByRole("button", { name: "Add book" }));
    expect(
      await screen.findByRole("heading", { name: "Emma" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Volume I, Chapter I")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "All books" }));
    await user.click(screen.getByRole("button", { name: "Add book" }));
    await screen.findByRole("heading", { name: "Emma" });
    await user.click(screen.getByRole("button", { name: "All books" }));
    expect(screen.getAllByRole("button", { name: /Emma/u })).toHaveLength(1);
  });

  test("a cancelled dialog changes nothing", async () => {
    const user = userEvent.setup();
    setMockBookPick(null);
    render(<Shelf />);

    await user.click(await screen.findByRole("button", { name: "Add book" }));
    expect(screen.getByRole("heading", { name: "Books" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test.each([
    [
      "/home/you/Books/drm.epub",
      "This book is copy-protected (DRM), so Ogmios can't read it.",
    ],
    [
      "/home/you/Books/unreadable.epub",
      "This file couldn't be read as an EPUB or PDF book.",
    ],
    [
      "/home/you/Books/scanned.pdf",
      "This PDF is a scan: its pages are images with no text, so Ogmios can't read it.",
    ],
  ])("a refused file (%s) says why", async (path, message) => {
    const user = userEvent.setup();
    setMockBookPick(path);
    render(<Shelf />);

    await user.click(await screen.findByRole("button", { name: "Add book" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("heading", { name: "Books" })).toBeInTheDocument();
  });

  test("the refusal is worded in Spanish too", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    setMockBookPick("/home/you/Books/drm.epub");
    render(<Shelf />);

    await user.click(
      await screen.findByRole("button", { name: "Añadir libro" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este libro está protegido contra copia (DRM), así que Ogmios no puede leerlo.",
    );
  });

  test("a scanned PDF is refused in Spanish too", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    setMockBookPick("/home/you/Books/scanned.pdf");
    render(<Shelf />);

    await user.click(
      await screen.findByRole("button", { name: "Añadir libro" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este PDF es un escaneo: sus páginas son imágenes sin texto, así que Ogmios no puede leerlo.",
    );
  });

  test("a PDF without bookmarks shows numbered sections, and one can be renamed", async () => {
    const user = userEvent.setup();
    setMockBookPick("/home/you/Books/wonderland.pdf");
    render(<Shelf />);

    await user.click(await screen.findByRole("button", { name: "Add book" }));
    await screen.findByRole("heading", { name: "wonderland" });
    const rows = (): Array<string | null> =>
      screen.getAllByRole("listitem").map((row) => row.textContent);
    expect(rows()).toEqual([
      "1Section 13120 words",
      "2Section 23054 words",
      "3Section 32210 words",
    ]);

    await user.click(screen.getByRole("button", { name: "Rename Section 2" }));
    const name = screen.getByRole("textbox", { name: "Chapter name" });
    expect(name).toHaveValue("");
    await user.type(name, "  The Pool   of Tears{Enter}");
    expect(
      await screen.findByRole("button", { name: "Rename The Pool of Tears" }),
    ).toBeInTheDocument();
    expect(rows()).toEqual([
      "1Section 13120 words",
      "2The Pool of Tears3054 words",
      "3Section 32210 words",
    ]);

    // The name is the book's from then on, not only this screen's.
    await user.click(screen.getByRole("button", { name: "All books" }));
    await user.click(screen.getByRole("button", { name: /wonderland/u }));
    expect(screen.getByText("The Pool of Tears")).toBeInTheDocument();

    // Cancelling leaves the name alone; an empty name gives the number back.
    await user.click(
      screen.getByRole("button", { name: "Rename The Pool of Tears" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Chapter name" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("The Pool of Tears")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Rename The Pool of Tears" }),
    );
    await user.clear(screen.getByRole("textbox", { name: "Chapter name" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(
      await screen.findByRole("button", { name: "Rename Section 2" }),
    ).toBeInTheDocument();
  });

  test("sections are numbered in Spanish too", async () => {
    const user = userEvent.setup();
    await i18n.changeLanguage("es");
    setMockBookPick("/home/you/Books/wonderland.pdf");
    render(<Shelf />);

    await user.click(
      await screen.findByRole("button", { name: "Añadir libro" }),
    );
    expect(await screen.findByText("Sección 2")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Cambiar el nombre de Sección 2" }),
    ).toBeInTheDocument();
  });

  test("deleting asks first, then the book is gone", async () => {
    const user = userEvent.setup();
    render(<Shelf />);
    await user.click(
      await screen.findByRole("button", {
        name: /Alice's Adventures in Wonderland/u,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Delete book" }));
    expect(
      screen.getByText(
        "Delete this book, its chapters and your progress in it?",
      ),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(
      screen.getByRole("heading", { name: "Alice's Adventures in Wonderland" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Delete book" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(
      await screen.findByText(
        "No books yet. Add an EPUB or a PDF to see its chapters.",
      ),
    ).toBeInTheDocument();
  });
});

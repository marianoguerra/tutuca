export type Book = { title: string; read: boolean };

export function unread(books: Readonly<Book[]>): number {
	return books.filter((b) => !b.read).length;
}

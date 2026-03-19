# Fumadocs Setup

This project uses [Fumadocs](https://fumadocs.dev/) for documentation.

## Project Structure

- `app/` - Next.js app router pages and layouts
- `content/docs/` - Documentation content (MDX files)
- `lib/` - Source loader and layout configuration

## Adding Content

1. Add `.mdx` or `.md` files to `content/docs/`
2. Use frontmatter for metadata (title, description)
3. The sidebar updates automatically from the file structure

## Customization

- Edit `lib/layout.shared.tsx` for navigation and layout options
- Edit `source.config.ts` to change content source configuration
- Modify `app/globals.css` for theme customization

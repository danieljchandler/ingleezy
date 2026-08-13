import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import ts from "typescript";

/**
 * Reads the route table straight out of `src/App.tsx`.
 *
 * Parsed with the TypeScript compiler API rather than a regex: the routes live
 * in 250 lines of nested JSX where the `/admin` children are relative to their
 * parent and the guard is a wrapper component several levels inside `element`.
 * A regex over that would be wrong in ways nobody would notice for months.
 *
 * The point is to make the route list a fact the tests derive rather than a
 * list somebody remembers to update.
 */

export interface DeclaredRoute {
  /** Full path, with the parent prefix applied for nested routes. */
  path: string;
  /** Whether the element is wrapped in <ProtectedRoute>. */
  protected: boolean;
  /** The `name` given to the wrapping <ErrorBoundary>, if any. */
  boundary?: string;
  /** Target of a <Navigate to="..."> element, for redirect-only routes. */
  redirectsTo?: string;
  /** Whether this route is nested under another (i.e. an /admin child). */
  nested: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const APP_PATH = resolve(here, "../../../App.tsx");

/** Read a string-literal JSX attribute. */
function stringAttribute(element: ts.JsxOpeningLikeElement, name: string): string | undefined {
  for (const attribute of element.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== name) continue;

    const initializer = attribute.initializer;
    if (initializer && ts.isStringLiteral(initializer)) return initializer.text;
    if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      ts.isStringLiteral(initializer.expression)
    ) {
      return initializer.expression.text;
    }
  }
  return undefined;
}

/** Find the JSX expression passed as `element={...}`. */
function elementAttribute(node: ts.JsxOpeningLikeElement): ts.Node | undefined {
  for (const attribute of node.attributes.properties) {
    if (!ts.isJsxAttribute(attribute)) continue;
    if (attribute.name.getText() !== "element") continue;
    if (attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
      return attribute.initializer.expression;
    }
  }
  return undefined;
}

const tagName = (node: ts.Node): string | undefined => {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText();
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText();
  return undefined;
};

/** Walk an `element={...}` subtree looking for the guards we care about. */
function inspectElement(root: ts.Node): {
  protected: boolean;
  boundary?: string;
  redirectsTo?: string;
} {
  let isProtected = false;
  let boundary: string | undefined;
  let redirectsTo: string | undefined;

  const visit = (node: ts.Node) => {
    const tag = tagName(node);

    if (tag === "ProtectedRoute") isProtected = true;

    if (tag === "ErrorBoundary" && boundary === undefined) {
      const opening = ts.isJsxElement(node) ? node.openingElement : (node as ts.JsxSelfClosingElement);
      boundary = stringAttribute(opening, "name");
    }

    if (tag === "Navigate") {
      const opening = ts.isJsxElement(node) ? node.openingElement : (node as ts.JsxSelfClosingElement);
      redirectsTo = stringAttribute(opening, "to");
    }

    ts.forEachChild(node, visit);
  };

  visit(root);
  return { protected: isProtected, boundary, redirectsTo };
}

/** Join a parent route path with a child's relative path. */
function joinPaths(parent: string, child: string): string {
  if (child.startsWith("/")) return child;
  if (child === "") return parent;
  return `${parent.replace(/\/$/, "")}/${child}`;
}

export function parseAppRoutes(source = readFileSync(APP_PATH, "utf8")): DeclaredRoute[] {
  const file = ts.createSourceFile("App.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes: DeclaredRoute[] = [];

  const visit = (node: ts.Node, parentPath: string | null) => {
    const tag = tagName(node);

    if (tag === "Route") {
      const opening = ts.isJsxElement(node) ? node.openingElement : (node as ts.JsxSelfClosingElement);

      const rawPath = stringAttribute(opening, "path");
      const isIndex = opening.attributes.properties.some(
        (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "index",
      );

      // An <Route index> renders at exactly its parent's path.
      const path =
        rawPath !== undefined
          ? parentPath !== null
            ? joinPaths(parentPath, rawPath)
            : rawPath
          : isIndex && parentPath !== null
            ? parentPath
            : undefined;

      if (path !== undefined) {
        const element = elementAttribute(opening);
        const details = element ? inspectElement(element) : { protected: false };

        routes.push({
          path,
          protected: details.protected,
          boundary: details.boundary,
          redirectsTo: details.redirectsTo,
          nested: parentPath !== null,
        });

        // Children of a layout route are relative to it.
        if (ts.isJsxElement(node)) {
          for (const child of node.children) visit(child, path);
          return;
        }
      }
    }

    ts.forEachChild(node, (child) => visit(child, parentPath));
  };

  visit(file, null);
  return routes;
}

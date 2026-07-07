---
"leadtype": minor
---

Add a `ChildrenTypeRegistry` augmentation hook to `leadtype/mdx`, so
framework consumers type `children` once per project instead of casting in
every component. Leadtype still ships zero renderer dependencies — the
registry is empty by default and `children` stays `unknown` (no behavior
change without opting in):

```ts
// types.d.ts
declare module "leadtype/mdx" {
  interface ChildrenTypeRegistry {
    type: import("react").ReactNode;
  }
}
export {}; // module marker: augments the package instead of replacing it
```

After that single declaration, every tag prop type (`CalloutProps`,
`TabsProps`, `StepProps`, …) exposes correctly typed `children` — verified
through the published type rollup, and adopted by the React examples in the
docs. The resolved type is also exported as `TagChildren`.

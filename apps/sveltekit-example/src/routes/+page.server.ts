import { redirect } from "@sveltejs/kit";

export const prerender = false;

export const load = () => {
  throw redirect(308, "/docs");
};

import { Redirect } from "expo-router";
import { useSession } from "../providers/SessionProvider";

export function useRequireOwner() {
  const session = useSession();
  if (!session.user) {
    return <Redirect href="/login" />;
  }
  return null;
}

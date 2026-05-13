import { Redirect } from "expo-router";
import { AppSplash } from "../src/components/AppSplash";
import { OwnerLoginScreen } from "../src/screens/OwnerLoginScreen";
import { useSession } from "../src/providers/SessionProvider";

export default function LoginRoute() {
  const session = useSession();

  if (session.booting) {
    return <AppSplash />;
  }

  if (!session.token || session.approvalStatus !== "APPROVED") {
    return <Redirect href="/" />;
  }

  if (session.user) {
    return <Redirect href="/dashboard" />;
  }

  return <OwnerLoginScreen />;
}

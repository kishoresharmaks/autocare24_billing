import { Redirect } from "expo-router";
import { AppSplash } from "../src/components/AppSplash";
import { ApprovalScreen } from "../src/screens/ApprovalScreen";
import { OwnerLoginScreen } from "../src/screens/OwnerLoginScreen";
import { SetupScreen } from "../src/screens/SetupScreen";
import { useSession } from "../src/providers/SessionProvider";

export default function EntryScreen() {
  const session = useSession();

  if (session.booting) {
    return <AppSplash />;
  }

  if (!session.token) {
    return <SetupScreen />;
  }

  if (session.approvalStatus !== "APPROVED") {
    return <ApprovalScreen />;
  }

  if (!session.user) {
    return <Redirect href="/login" />;
  }

  return <Redirect href="/dashboard" />;
}

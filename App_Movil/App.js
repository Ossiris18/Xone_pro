import { PaperProvider } from "react-native-paper";
import Navigation from "./src/navigation/Navigation";

export default function App() {
  return (
    <PaperProvider>
      <Navigation />
    </PaperProvider>
  );
}

export const metadata = {
  title: "SonicStream",
  description: "Sonic-enhanced LLM streaming interface",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}

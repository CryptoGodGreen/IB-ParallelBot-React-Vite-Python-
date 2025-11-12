export default function Navbar() {
  // Navbar is now minimal - just a spacer bar
  // Logo and user dropdown moved to HeaderBar
  return (
    <nav className="fixed top-0 inset-x-0 z-40 shadow-xl">
      <div className="relative">
        {/* Gradient bar */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600 via-indigo-600 to-fuchsia-600 opacity-80 blur-md"></div>
        <div className="relative backdrop-blur-sm bg-slate-900/70 border-b border-slate-800">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16">
            {/* Empty navbar - logo and user moved to HeaderBar */}
          </div>
        </div>
      </div>
    </nav>
  );
}
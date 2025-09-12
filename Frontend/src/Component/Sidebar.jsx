import { Link, useLocation } from "react-router-dom";

const Sidebar = ({ isOpen, toggleSidebar }) => {
  const location = useLocation();
  const menu = [
    {
      category: "Stocks",
      items: [
        { name: "Apple", symbol: "AAPL" },
        { name: "Google", symbol: "GOOGL" },
        { name: "Microsoft", symbol: "MSFT" },
        { name: "Amazon", symbol: "AMZN" },
        { name: "Tesla", symbol: "TSLA" },
      ],
    },
  ];

  return (
    <div
      className={`transition-all duration-300 bg-gray-900
      ${isOpen ? "w-60 p-4" : "w-0 p-0 overflow-hidden"}
      h-screen overflow-y-auto`}
    >
      {isOpen && (
        <>
          {/* Close Button */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold text-gray-300">Markets</h2>
            <button
              onClick={toggleSidebar}
              className="text-gray-400 hover:text-red-500 text-xl"
            >
              ✖
            </button>
          </div>

          {/* Menu */}
          {menu.map((section) => (
            <div key={section.category} className="mb-6">
              <h4 className="text-sm font-semibold text-gray-400 mb-2 border-b border-gray-700 pb-1">
                {section.category}
              </h4>
              <ul className="space-y-2">
                {section.items.map((item) => {
                  const isActive = location.pathname === `/stock/${item.symbol}`;
                  return (
                    <li key={item.symbol}>
                      <Link
                        to={`/stock/${item.symbol}`}
                        className={`block px-2 py-1 rounded transition-colors ${
                          isActive
                            ? "bg-blue-600 text-white"
                            : "text-gray-300 hover:bg-blue-500 hover:text-white"
                        }`}
                      >
                        {item.name}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </>
      )}
    </div>
  );
};

export default Sidebar;

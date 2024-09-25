# TPE Sushi Go Round

TPE Sushi Go Round is a web application built with Vite that displays arrival baggage carousel and parking bay information for Taiwan Taoyuan International Airport using their JSON API. This application is specifically designed for Taiwan major airline flight and cabin crews.

## Project Description

This project is a web-based application that provides real-time information about baggage carousels and parking bays for arriving flights at Taiwan Taoyuan International Airport. It utilizes the airport's JSON API to fetch and display up-to-date information, offering a user-friendly interface tailored for flight and cabin crews of major Taiwanese airlines.

Key features:
- Real-time display of baggage carousel assignments for arriving flights
- Information on parking bay allocations for aircraft
- Built with modern web technologies for a fast and responsive user experience
- Tailored interface for airline crew members to quickly access relevant information

## Development Environment Setup

To set up the development environment for this project, follow these steps:

1. Ensure you have [Node.js](https://nodejs.org/) installed on your system (version 12.0 or higher is recommended).

2. Clone this repository to your local machine:
   ```
   git clone git@github.com:TPE-eagle/tpe-sushi-go-round.git
   cd tpe-sushi-go-round
   ```

3. Install the project dependencies:
   ```
   npm install
   ```

4. To start the development server, run:
   ```
   npm run dev
   ```

   This will start the Vite development server, usually at `http://localhost:5173`.

5. To build the project for production, use:
   ```
   npm run build
   ```

6. To preview the production build, use:
   ```
   npm run preview
   ```

## Project Structure

The main code for this project is located in the following files:

- `index.html`: The main HTML file that serves as the entry point for the application.
- `main.js`: The main JavaScript file where the application logic is implemented, including API calls and data processing.
- `style.css`: The main CSS file for styling the application.

Additional important files:

- `vite.config.js`: Configuration file for Vite.
- `package.json`: Defines the project dependencies and scripts.

## Dependencies

This project uses the following main dependencies:

- [Vite](https://vitejs.dev/): A build tool that aims to provide a faster and leaner development experience for modern web projects.
- [Sass](https://sass-lang.com/): A CSS extension language that allows for more powerful styling capabilities.
- [Bootstrap](https://getbootstrap.com/): A popular CSS framework for building responsive and mobile-first websites.
- [@popperjs/core](https://popper.js.org/): A positioning engine required for Bootstrap's dropdowns, popovers, and tooltips.

## API Usage

This application interacts with the Taiwan Taoyuan International Airport's JSON API to fetch real-time data. Ensure you have the necessary API credentials and comply with the airport's terms of service when using their data.

## Contributing

To contribute to this project, please follow the standard Git workflow:

1. Fork the repository
2. Create a new branch for your feature
3. Commit your changes
4. Push to your fork
5. Submit a pull request

Please ensure your code adheres to the existing style conventions and includes appropriate tests.
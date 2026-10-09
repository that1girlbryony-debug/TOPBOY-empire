/**
 * 🛠 src/data/triviaFallback.js — Phase 2 / 2.5 (NEW)
 * Local trivia question bank — used when opentdb.com API is down.
 *
 * 🛠 FIX (Phase 1 audit noted this missing): if opentdb.com was
 * unreachable, spawnTrivia silently returned false and the user got
 * no message at all. Now we fall back to these ~30 questions.
 *
 * Phase 4 will add: retry once after 2s before falling back; for
 * Phase 2 just having the fallback is enough.
 *
 * Format matches what spawnTrivia expects from the API:
 *   { question, correct_answer, incorrect_answers: [3], difficulty, category }
 * (we'll merge + shuffle on use)
 */

module.exports = [
  {
    category: "Geography",
    difficulty: "easy",
    question: "What is the capital of Japan?",
    correct_answer: "Tokyo",
    incorrect_answers: ["Seoul", "Beijing", "Bangkok"]
  },
  {
    category: "Geography",
    difficulty: "easy",
    question: "Which is the largest ocean on Earth?",
    correct_answer: "Pacific Ocean",
    incorrect_answers: ["Atlantic Ocean", "Indian Ocean", "Arctic Ocean"]
  },
  {
    category: "Geography",
    difficulty: "medium",
    question: "Mount Kilimanjaro is located in which country?",
    correct_answer: "Tanzania",
    incorrect_answers: ["Kenya", "Uganda", "Ethiopia"]
  },
  {
    category: "Science",
    difficulty: "easy",
    question: "What is the chemical symbol for water?",
    correct_answer: "H2O",
    incorrect_answers: ["CO2", "NaCl", "O2"]
  },
  {
    category: "Science",
    difficulty: "medium",
    question: "What planet is known as the Red Planet?",
    correct_answer: "Mars",
    incorrect_answers: ["Venus", "Jupiter", "Mercury"]
  },
  {
    category: "Science",
    difficulty: "medium",
    question: "What is the hardest natural substance on Earth?",
    correct_answer: "Diamond",
    incorrect_answers: ["Gold", "Iron", "Quartz"]
  },
  {
    category: "Science",
    difficulty: "hard",
    question: "What is the speed of light in a vacuum (approximate)?",
    correct_answer: "300,000 km/s",
    incorrect_answers: ["150,000 km/s", "1,000,000 km/s", "30,000 km/s"]
  },
  {
    category: "History",
    difficulty: "easy",
    question: "In which year did World War II end?",
    correct_answer: "1945",
    incorrect_answers: ["1939", "1918", "1950"]
  },
  {
    category: "History",
    difficulty: "medium",
    question: "Who was the first President of the United States?",
    correct_answer: "George Washington",
    incorrect_answers: ["Thomas Jefferson", "Abraham Lincoln", "John Adams"]
  },
  {
    category: "History",
    difficulty: "medium",
    question: "The Great Pyramid of Giza was built as a tomb for which pharaoh?",
    correct_answer: "Khufu",
    incorrect_answers: ["Tutankhamun", "Ramses II", "Cleopatra"]
  },
  {
    category: "Sports",
    difficulty: "easy",
    question: "How many players are on a soccer team on the field?",
    correct_answer: "11",
    incorrect_answers: ["9", "10", "12"]
  },
  {
    category: "Sports",
    difficulty: "medium",
    question: "In which sport would you perform a slam dunk?",
    correct_answer: "Basketball",
    incorrect_answers: ["Volleyball", "Tennis", "Baseball"]
  },
  {
    category: "Sports",
    difficulty: "hard",
    question: "Which country won the first FIFA World Cup in 1930?",
    correct_answer: "Uruguay",
    incorrect_answers: ["Brazil", "Argentina", "Italy"]
  },
  {
    category: "Music",
    difficulty: "easy",
    question: "How many strings does a standard guitar have?",
    correct_answer: "6",
    incorrect_answers: ["4", "5", "7"]
  },
  {
    category: "Music",
    difficulty: "medium",
    question: "Which band performed the song 'Bohemian Rhapsody'?",
    correct_answer: "Queen",
    incorrect_answers: ["The Beatles", "Led Zeppelin", "Pink Floyd"]
  },
  {
    category: "Animals",
    difficulty: "easy",
    question: "What is the largest land animal?",
    correct_answer: "African Elephant",
    incorrect_answers: ["Giraffe", "Hippopotamus", "Rhinoceros"]
  },
  {
    category: "Animals",
    difficulty: "medium",
    question: "How many hearts does an octopus have?",
    correct_answer: "3",
    incorrect_answers: ["1", "2", "4"]
  },
  {
    category: "Animals",
    difficulty: "hard",
    question: "What is the only mammal capable of true flight?",
    correct_answer: "Bat",
    incorrect_answers: ["Flying squirrel", "Sugar glider", "Colugo"]
  },
  {
    category: "Movies",
    difficulty: "easy",
    question: "Who played Jack in Titanic (1997)?",
    correct_answer: "Leonardo DiCaprio",
    incorrect_answers: ["Brad Pitt", "Tom Cruise", "Matt Damon"]
  },
  {
    category: "Movies",
    difficulty: "medium",
    question: "Which movie features the quote 'May the Force be with you'?",
    correct_answer: "Star Wars",
    incorrect_answers: ["Star Trek", "The Matrix", "Dune"]
  },
  {
    category: "Movies",
    difficulty: "hard",
    question: "Who directed the movie 'Pulp Fiction'?",
    correct_answer: "Quentin Tarantino",
    incorrect_answers: ["Martin Scorsese", "Steven Spielberg", "Christopher Nolan"]
  },
  {
    category: "Literature",
    difficulty: "medium",
    question: "Who wrote 'Romeo and Juliet'?",
    correct_answer: "William Shakespeare",
    incorrect_answers: ["Charles Dickens", "Jane Austen", "Mark Twain"]
  },
  {
    category: "Literature",
    difficulty: "hard",
    question: "In '1984', what is the name of the totalitarian leader?",
    correct_answer: "Big Brother",
    incorrect_answers: ["The Party Leader", "Comrade Stalin", "The Director"]
  },
  {
    category: "Technology",
    difficulty: "easy",
    question: "What does 'HTTP' stand for?",
    correct_answer: "HyperText Transfer Protocol",
    incorrect_answers: ["High Tech Transfer Process", "HyperText Transmission Protocol", "Home Tool Transfer Protocol"]
  },
  {
    category: "Technology",
    difficulty: "medium",
    question: "Who is the co-founder of Microsoft along with Bill Gates?",
    correct_answer: "Paul Allen",
    incorrect_answers: ["Steve Jobs", "Steve Ballmer", "Mark Zuckerberg"]
  },
  {
    category: "Technology",
    difficulty: "hard",
    question: "What does 'CPU' stand for?",
    correct_answer: "Central Processing Unit",
    incorrect_answers: ["Computer Personal Unit", "Central Process Utility", "Common Processing Unit"]
  },
  {
    category: "Food",
    difficulty: "easy",
    question: "What is the main ingredient in guacamole?",
    correct_answer: "Avocado",
    incorrect_answers: ["Tomato", "Pea", "Cucumber"]
  },
  {
    category: "Food",
    difficulty: "medium",
    question: "Which country is the origin of the pizza?",
    correct_answer: "Italy",
    incorrect_answers: ["France", "Greece", "Spain"]
  },
  {
    category: "Math",
    difficulty: "easy",
    question: "What is 7 × 8?",
    correct_answer: "56",
    incorrect_answers: ["54", "58", "64"]
  },
  {
    category: "Math",
    difficulty: "medium",
    question: "What is the square root of 144?",
    correct_answer: "12",
    incorrect_answers: ["14", "10", "16"]
  },
];

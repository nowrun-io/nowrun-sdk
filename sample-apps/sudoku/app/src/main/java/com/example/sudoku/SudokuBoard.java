package com.example.sudoku;

import gg.now.bridge.ProviderService;
import gg.now.bridge.ProviderService.Describe;

import java.util.Random;

/**
 * The game itself: 81 cells, the rules, and a solver. No Android in here.
 *
 * Every method is synchronized because the board is touched both by taps on the main
 * thread and by calls arriving from the client on worker threads.
 *
 * Visibility is the bridge's surface: ProviderService reflects over the public methods and
 * exposes every one of them, so only what a client should be able to call is public -
 * getState, newGame, restart, setCell, solve. The rest stays package-private, which
 * MainActivity reaches all the same, and a client cannot. Widening one of them publishes it.
 */
public class SudokuBoard {

    public static final int SIZE = 9;
    public static final int CELLS = SIZE * SIZE;

    /** '.' is a blank. Each is a real puzzle with a unique solution. */
    /** '.' is a blank. Each was generated and checked to have exactly one solution. */
    private static final String[] PUZZLES = {
            "7..629...2...1.....46........3...5..5......831...7..6....1...78.....62.449..8.3..",
            ".3.....98...7...6........5....2.4.3.......2..19..5....57.318...9.....6..4...2....",
            ".8...79...178...3..429.5........2........65.1..4....89..1...7.3.6..39..........5.",
            "2...8.7........2.1...1.6..8.7.5.1...8......3...3.7..4.6......19..2..5......6.7..2",
    };

    private final Random random = new Random();

    /** The clues, fixed for the round. Zero means the player fills it in. */
    private final int[] given = new int[CELLS];
    private final int[] cells = new int[CELLS];

    /** The puzzle's own answer, worked out once from the clues alone. */
    private final int[] solution = new int[CELLS];
    private boolean solvable;

    public SudokuBoard() {
        newGame();
    }

    @Describe("Starts a fresh puzzle, discarding anything entered in the current one.")
    public synchronized void newGame() {
        load(PUZZLES[random.nextInt(PUZZLES.length)]);
        reportStateChange();
    }

    @Describe("Fills one cell with a digit, or clears it with 0. Refuses to overwrite a clue.")
    public synchronized String setCell(
            @Describe("Row, 1-9 from the top.") int row,
            @Describe("Column, 1-9 from the left.") int col,
            @Describe("Digit 1-9 to place, or 0 to clear the cell.") int value) {
        if (row < 1 || row > SIZE || col < 1 || col > SIZE) {
            return "error: row and col must be 1-" + SIZE + ", got R" + row + "C" + col;
        }
        if (value < 0 || value > SIZE) {
            return "error: value must be 0-" + SIZE + ", got " + value;
        }
        int index = (row - 1) * SIZE + (col - 1);
        if (given[index] != 0) {
            return "error: R" + row + "C" + col + " is a clue, holding " + given[index];
        }
        cells[index] = value;
        reportStateChange();
        String where = "R" + row + "C" + col;
        if (value == 0) {
            return where + " cleared";
        }
        return where + " = " + value + (conflicts(index) ? " (conflicts)" : "");
    }

    /**
     * The board as it stands, for a client that wants to ask rather than wait to be told.
     *
     * Deliberately the very same payload a state change carries, so the two never drift
     * into disagreeing about what the board looks like.
     */
    @Describe("The board as it stands right now, same shape as a pushed state change.")
    public synchronized String getState() {
        return stateJson();
    }

    synchronized void reportStateChange() {
        MainActivity.refreshBoard();
        ProviderService.notifyStateChange(stateJson());
    }

    private String stateJson() {
        StringBuilder out = new StringBuilder("{\"board\":[");
        for (int row = 0; row < SIZE; row++) {
            if (row > 0) {
                out.append(',');
            }
            out.append('"');
            for (int col = 0; col < SIZE; col++) {
                int value = cells[row * SIZE + col];
                out.append(value == 0 ? '.' : (char) ('0' + value));
            }
            out.append('"');
        }
        return out.append("]}").toString();
    }

    synchronized void load(String puzzle) {
        for (int i = 0; i < CELLS; i++) {
            char c = i < puzzle.length() ? puzzle.charAt(i) : '.';
            int value = (c >= '1' && c <= '9') ? c - '0' : 0;
            given[i] = value;
            cells[i] = value;
        }

        // Solve from the clues now, so hints never depend on what the player typed.
        int[] work = given.clone();
        solvable = search(work, 0);
        if (solvable) {
            System.arraycopy(work, 0, solution, 0, CELLS);
        }
    }

    /** Clears everything the player entered, keeping the clues. */
    @Describe("Clears every cell the player entered, keeping the original clues.")
    public synchronized void restart() {
        System.arraycopy(given, 0, cells, 0, CELLS);
        reportStateChange();
    }

    synchronized int get(int index) {
        return cells[index];
    }

    synchronized boolean isGiven(int index) {
        return given[index] != 0;
    }

    /** Writes a value, or 0 to blank it. Refuses to touch a clue. */
    synchronized boolean set(int index, int value) {
        if (index < 0 || index >= CELLS || value < 0 || value > 9 || given[index] != 0) {
            return false;
        }
        cells[index] = value;
        reportStateChange();
        return true;
    }

    /** True when this cell repeats a value already in its row, column or block. */
    synchronized boolean conflicts(int index) {
        int value = cells[index];
        if (value == 0) {
            return false;
        }
        int row = index / SIZE;
        int col = index % SIZE;
        for (int i = 0; i < SIZE; i++) {
            int inRow = row * SIZE + i;
            int inCol = i * SIZE + col;
            if (inRow != index && cells[inRow] == value) {
                return true;
            }
            if (inCol != index && cells[inCol] == value) {
                return true;
            }
        }
        int blockRow = (row / 3) * 3;
        int blockCol = (col / 3) * 3;
        for (int r = blockRow; r < blockRow + 3; r++) {
            for (int c = blockCol; c < blockCol + 3; c++) {
                int at = r * SIZE + c;
                if (at != index && cells[at] == value) {
                    return true;
                }
            }
        }
        return false;
    }

    synchronized boolean isFull() {
        for (int value : cells) {
            if (value == 0) {
                return false;
            }
        }
        return true;
    }

    synchronized boolean isSolved() {
        if (!isFull()) {
            return false;
        }
        for (int i = 0; i < CELLS; i++) {
            if (conflicts(i)) {
                return false;
            }
        }
        return true;
    }

    synchronized int blanks() {
        int count = 0;
        for (int value : cells) {
            if (value == 0) {
                count++;
            }
        }
        return count;
    }

    /**
     * Fills one cell correctly: the first blank, or failing that the first wrong entry.
     * Returns its index, or -1 when the grid is already right.
     */
    synchronized int hint() {
        if (!solvable) {
            return -1;
        }
        for (int i = 0; i < CELLS; i++) {
            if (cells[i] == 0) {
                cells[i] = solution[i];
                reportStateChange();
                return i;
            }
        }
        for (int i = 0; i < CELLS; i++) {
            if (cells[i] != solution[i]) {
                cells[i] = solution[i];
                reportStateChange();
                return i;
            }
        }
        return -1;
    }

    /** Reveals the answer, replacing anything entered wrongly. */
    @Describe("Fills in the full solution, overwriting any wrong entries. Returns false if the current puzzle has no solution.")
    public synchronized boolean solve() {
        if (!solvable) {
            return false;
        }
        System.arraycopy(solution, 0, cells, 0, CELLS);
        reportStateChange();
        return true;
    }

    /** How many filled-in cells disagree with the answer. */
    synchronized int mistakes() {
        if (!solvable) {
            return 0;
        }
        int wrong = 0;
        for (int i = 0; i < CELLS; i++) {
            if (cells[i] != 0 && cells[i] != solution[i]) {
                wrong++;
            }
        }
        return wrong;
    }

    /** Plain backtracking: first blank cell, try 1..9, recurse. */
    private static boolean search(int[] board, int index) {
        if (index == CELLS) {
            return true;
        }
        if (board[index] != 0) {
            return search(board, index + 1);
        }
        for (int value = 1; value <= SIZE; value++) {
            if (allowed(board, index, value)) {
                board[index] = value;
                if (search(board, index + 1)) {
                    return true;
                }
                board[index] = 0;
            }
        }
        return false;
    }

    private static boolean allowed(int[] board, int index, int value) {
        int row = index / SIZE;
        int col = index % SIZE;
        for (int i = 0; i < SIZE; i++) {
            if (board[row * SIZE + i] == value || board[i * SIZE + col] == value) {
                return false;
            }
        }
        int blockRow = (row / 3) * 3;
        int blockCol = (col / 3) * 3;
        for (int r = blockRow; r < blockRow + 3; r++) {
            for (int c = blockCol; c < blockCol + 3; c++) {
                if (board[r * SIZE + c] == value) {
                    return false;
                }
            }
        }
        return true;
    }

    /** Nine lines of nine digits, blanks as dots. */
    synchronized String toText() {
        StringBuilder out = new StringBuilder();
        for (int row = 0; row < SIZE; row++) {
            for (int col = 0; col < SIZE; col++) {
                int value = cells[row * SIZE + col];
                out.append(value == 0 ? '.' : (char) ('0' + value));
            }
            if (row < SIZE - 1) {
                out.append('\n');
            }
        }
        return out.toString();
    }
}

// Recovered from OpenUI SDK 1.0.0, f7109dd01b7bdfb14c8c9006eaca5a8b3cfc3a20 (MIT).
export const enum T {
  Newline = 0, LParen = 1, RParen = 2, LBrack = 3, RBrack = 4,
  LBrace = 5, RBrace = 6, Comma = 7, Colon = 8, Equals = 9,
  True = 10, False = 11, Null = 12, EOF = 13, Str = 14, Num = 15,
  Ident = 16, Type = 17, StateVar = 18, Dot = 19, Plus = 20,
  Minus = 21, Star = 22, Slash = 23, Percent = 24, EqEq = 25,
  NotEq = 26, Greater = 27, Less = 28, GreaterEq = 29, LessEq = 30,
  And = 31, Or = 32, Not = 33, Question = 34, BuiltinCall = 35,
}
export type Token = { t: T; v?: string | number };

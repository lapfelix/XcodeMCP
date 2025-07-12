//
//  TestAppTests.swift
//  TestAppTests
//
//  Created by Felix Lapalme on 2025-07-11.
//

import Testing
@testable import TestApp

struct TestAppTests {

    @Test func example() async throws {
        // Write your test here and use APIs like `#expect(...)` to check expected conditions.
    }
    
    @Test func testStringManipulation() async throws {
        let input = "Hello, World!"
        let result = input.uppercased()
        #expect(result == "HELLO, WORLD!")
    }
    
    @Test func testArrayOperations() async throws {
        let numbers = [1, 2, 3, 4, 5]
        let doubled = numbers.map { $0 * 2 }
        #expect(doubled == [2, 4, 6, 8, 10])
    }
    
    @Test func testDictionaryAccess() async throws {
        let userInfo = ["name": "John", "age": "30"]
        #expect(userInfo["name"] == "John")
        #expect(userInfo["age"] == "30")
    }
    
    @Test func testOptionalHandling() async throws {
        let optionalValue: String? = "test"
        #expect(optionalValue != nil)
        #expect(optionalValue! == "test")
    }
    
    @Test func testAsyncOperation() async throws {
        let result = await performAsyncTask()
        #expect(result == "completed")
    }
    
    private func performAsyncTask() async -> String {
        try? await Task.sleep(nanoseconds: 100_000_000) // 0.1 seconds
        return "completed"
    }
}

struct MathTests {
    
    @Test func testAddition() async throws {
        let result = add(2, 3)
        #expect(result == 5)
    }
    
    @Test func testSubtraction() async throws {
        let result = subtract(10, 4)
        #expect(result == 6)
    }
    
    @Test func testMultiplication() async throws {
        let result = multiply(3, 4)
        #expect(result == 12)
    }
    
    @Test func testDivision() async throws {
        let result = divide(15, 3)
        #expect(result == 5)
    }
    
    @Test func testDivisionByZero() async throws {
        let result = safeDivide(10, 0)
        #expect(result == nil)
    }
    
    private func add(_ a: Int, _ b: Int) -> Int {
        return a + b
    }
    
    private func subtract(_ a: Int, _ b: Int) -> Int {
        return a - b
    }
    
    private func multiply(_ a: Int, _ b: Int) -> Int {
        return a * b
    }
    
    private func divide(_ a: Int, _ b: Int) -> Int {
        return a / b
    }
    
    private func safeDivide(_ a: Int, _ b: Int) -> Int? {
        guard b != 0 else { return nil }
        return a / b
    }
}

struct NetworkTests {
    
    @Test func testURLValidation() async throws {
        let validURL = "https://www.example.com"
        let invalidURL = "not-a-url"
        
        #expect(isValidURL(validURL) == true)
        #expect(isValidURL(invalidURL) == false)
    }
    
    @Test func testJSONParsing() async throws {
        let jsonString = """
        {
            "name": "Test User",
            "id": 123
        }
        """
        
        let data = jsonString.data(using: .utf8)!
        let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        
        #expect(result?["name"] as? String == "Test User")
        #expect(result?["id"] as? Int == 123)
    }
    
    @Test func testHTTPStatusCodes() async throws {
        #expect(isSuccessStatusCode(200) == true)
        #expect(isSuccessStatusCode(404) == false)
        #expect(isSuccessStatusCode(500) == false)
    }
    
    private func isValidURL(_ urlString: String) -> Bool {
        return URL(string: urlString) != nil
    }
    
    private func isSuccessStatusCode(_ code: Int) -> Bool {
        return (200...299).contains(code)
    }
}

struct DatabaseTests {
    
    @Test func testUserCreation() async throws {
        let user = createUser(name: "Alice", email: "alice@example.com")
        
        #expect(user.name == "Alice")
        #expect(user.email == "alice@example.com")
        #expect(user.id > 0)
    }
    
    @Test func testUserValidation() async throws {
        let validUser = createUser(name: "Bob", email: "bob@example.com")
        let invalidUser = createUser(name: "", email: "invalid-email")
        
        #expect(isValidUser(validUser) == true)
        #expect(isValidUser(invalidUser) == false)
    }
    
    @Test func testDataPersistence() async throws {
        let user = createUser(name: "Charlie", email: "charlie@example.com")
        let saved = saveUser(user)
        
        #expect(saved == true)
    }
    
    private struct User {
        let id: Int
        let name: String
        let email: String
    }
    
    private func createUser(name: String, email: String) -> User {
        return User(id: Int.random(in: 1...1000), name: name, email: email)
    }
    
    private func isValidUser(_ user: User) -> Bool {
        return !user.name.isEmpty && user.email.contains("@")
    }
    
    private func saveUser(_ user: User) -> Bool {
        // Simulate database save
        return true
    }
}
